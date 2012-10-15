var useragent = 'Metapoint-WikipediaExternalLinkParser/0.1 (http://github.com/stuartpb/metapoint-welp; stuart@testtrack4.com)'
var wikihost = 'en.wikipedia.org'
var mphost = 'metapoint.io' //'localhost'

var http = require('http')
var url = require('url')

function imdbTemplate(type,abbr) {
  return {
    regex: RegExp(
      '{{\\s*IMDb[ _]'+type+'\\s*\\|(\\d*)\\|?(.*)}}',
      //the case insensitivity is to handle the majority of redirect cases
      'i'),
    hostname: 'www.imdb.com',
    path: function(match) {
      var id = match[1]
      if (id == '') {
        id = match[2].match(/id\s*=\s*(\d*)/)
        if (id) {
          id = id[1]
        } else {
          return null
        }
      }
      return '/'+type+'/'+abbr+'0000000'.slice(id.length,7)+id
    }
  }
}

var templates = {
  'IMDb_title': imdbTemplate('title','tt'),
  'IMDb_name': imdbTemplate('name','nm')
}

var targetTemplate = process.argv[2]

var pages = []
var eicontinue
var curpage = 0
var timerId
//Whether we're waiting for the response to a request.
var popWaiting = false

/* Enter a suggestion through the Metapoint interface.

  I was originally thinking I'd bypass the HTTP API for this
  and just suggest straight to the database backend, but then
  I decided that doesn't get me anything but a package dependency,
  a connection object to architect around, and an annoying requirement
  that this has to run on the server.

  This way I can run the script from my own clients as well as
  the server, with what's built into Node, and the loss is, what-
  100ms of IO throughput at 4 requests a second? */
function suggest(params, cb) {
  var req = http.request({
    host: mphost,
    path: url.format({
      pathname: '/api/v0/suggest',
      query: params
    }),
    headers: {
      'User-Agent': useragent
    },
    method: 'POST'
  },function(res){
  })

  req.on('error', function(e) {
    console.error('! problem with request: ' + e.message);
  })

  req.end()
}

function wpApiQuery(params, cb) {
  var req = http.request({
    host: wikihost,
    path: url.format({
      pathname: '/w/api.php',
      query: params
    }),
    headers: {
      'User-Agent': useragent
    }
  },function(res){
    var bodylist = []
    res.on('data', function (chunk) {
      bodylist.push(chunk)
    })
    res.on('end', function(){
      cb(res.statusCode,JSON.parse(bodylist.join('')))
    })
  })

  req.on('error', function(e) {
    console.error('! problem with request: ' + e.message);
  })

  req.end()
}

//Reset the pages data from an API response.
function populatePagesArray(code, body) {
  if (code == 200) {
    pages = body.query.embeddedin
    curpage = 0
    if(body['query-continue']) {
      eicontinue = body['query-continue'].embeddedin.eicontinue
    } else {
      eicontinue = undefined
    }
    popWaiting = false
    process.stdout.write('\n')
  } else {
    console.error('! WELP:NOOK '+code+' '+body)
  }
}

//Searches the content of an "External links" section
//for the template and makes a suggestion if found.
function searchElContent(title,content) {
  var match = content.match(templates[targetTemplate].regex)
  if(match) {
    var targetPath = templates[targetTemplate].path(match)
    if(targetPath) {
      var wpSuggestion = {
        host: wikihost,
        path: '/wiki/' + encodeURIComponent(title.replace(' ','_'))
      }
      var targetSuggestion = {
        host: templates[targetTemplate].hostname,
        path: targetPath
      }
      targetSuggestion.notes='WELP ' + title
        +'\nCapture: ' + match[0]

      var parend = title.match(/^(.*) \((.*)\)$/)
      if(parend){
        var scope = parend[2]
        //Easy way to knock out MANY of these scope parentheticals
        if(scope.match(/film$/) || scope.match(/TV series$/)){
          wpSuggestion.scope = scope
          wpSuggestion.topic = parend[1]
          targetSuggestion.scope = scope
          targetSuggestion.topic = parend[1]
        } else {
          //I'll probably delete the paren in the title in revision (ie. if it's "musical"),
          //but it might be part of the name (ie. some title that ends with parentheses)
          //in which case I'll delete the scope
          wpSuggestion.scope = scope
          wpSuggestion.topic = title
          targetSuggestion.scope = scope
          targetSuggestion.topic = title
        }
      } else {
        wpSuggestion.topic = title
        targetSuggestion.topic = title
      }
      suggest(wpSuggestion)
      suggest(targetSuggestion)
    } else {
      console.log('! WELP:BADPATH '+title)
    }
  } else {
    console.log('! WELP:TNIEL '+title)
  }
}

function findSections(code, pbody) {
  var title = pbody.parse.title

  //search backwards through the sections to find the 'External links'
  //(backwards because it's usually the last section)
  var i = pbody.parse.sections.length - 1;
  while(i >= 0 &&
    //Techncally the case should always be "External links",
    //but why be sensitive?
    pbody.parse.sections[i].line.toLowerCase() != "external links") --i;

  //If the search found something within the bounds of the list
  if(i >= 0) {
    //Get the text of the "External links" section
    //(yes yes, this query isn't on the timer. I'm okay with that.)
    wpApiQuery({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      //in reality, this is probably going to be i+1, but let's
      //use what we're given
      rvsection: pbody.parse.sections[i].index,
      titles: title,
      format: 'json'
    }, function(code,rbody) {
      if (code == 200) {
        searchElContent(title,
          //The object with the revisions is identified by the pageid.
          //Since it's going to be the only key in the query's pages,
          //I'm going with this.

          //Also, for the record, this is the dumbest dereference chain ever.

          rbody.query.pages[Object.keys(rbody.query.pages)[0]].revisions[0]['*'])
      } else {
        console.error('! WELP:NOOK '+code+' '+body)
      }
    })

  //If we ran through all the sections and went past the beginning
  } else {
    console.log('! WELP:NOEL '+title)
  }
}

function queryPage(page) {
  //Only query pages in the main namespace
  if(page.ns == 0){
    console.log(': '+page.title)
    wpApiQuery({
      action: 'parse',
      prop: 'sections',
      page: page.title,
      format: 'json'
    }, findSections)
  } else {
    console.log('^ '+page.title)
  }
}

function timer_cb() {
  //If we've run through all the pages we have and there are still more
  if((curpage == pages.length && eicontinue) || pages.length == 0) {
    if(popWaiting) {
      process.stdout.write('.')
    } else {
    //Query the API for the next group of pages
      process.stdout.write('@ Querying API for next group of pages ('+eicontinue+')...')

      var apiparams = {
        action: 'query',
        list: 'embeddedin',
        eititle: 'Template:'+targetTemplate,
        // last I checked, the largest limit Wikipedia
        // is comfortable with is 500, which is plenty
        eilimit: 500,
        format: 'json'
      }

      if(eicontinue) apiparams.eicontinue = eicontinue

      popWaiting = true;
      wpApiQuery(apiparams, populatePagesArray);
  }
  //Otherwise, if we're still parsing the current batch
  //(not done or waiting for the next batch of pages)
  } else if(curpage < pages.length) {
    queryPage(pages[curpage++]);
  // Otherwise, if we're done
  // (the previous condition falling through
  // indicates curpage == pages.length,
  // and the last query didn't have any more continuation tokens)
  } else if(!eicontinue) {
    // Stop the timer
    clearInterval(timerId)
  }
}

// Run
if(!targetTemplate){
  console.error('This script must be run with a target template as a parameter.')
} else if (!(targetTemplate in templates)) {
  console.error('Target template "'+targetTemplate+'" not found')
} else {
  console.log('Getting pages for "'+targetTemplate+'"...')
  if(process.argv[3]){eicontinue = process.argv[3]}
  timerId = setInterval(timer_cb,500)
}

