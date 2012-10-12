var useragent = 'Metapoint-WikipediaExternalLinkParser/0.1 (http://github.com/stuartpb/metapoint-welp; stuart@testtrack4.com)'
var wikihost = 'en.wikipedia.org'
var mphost = 'metapoint.io' //'localhost'

var http = require('http')
var url = require('url')

function imdbTemplate(type,abbr) {
  return {
    regex: RegExp(
      '{{IMDb[ _]'+type+'\\|(\\d*)\\|?(.*)}}',
      //the case insensitivity is to handle the majority of redirect cases
      'i'),
    hostname: 'www.imdb.com',
    path: function(match) {
      return '/'+type+'/'+abbr+'0000000'.slice(match[1].length,7)+idnum
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

/* Enter a suggestion through the Metapoint interface.

  I was originally thinking I'd bypass the HTTP API for this
  and just suggest straight to the database backend, but then
  I decided that doesn't get me anything but a package dependency,
  a connection object to architect around, and an annoying requirement
  that this has to run on the server.

  This way I can run the script from my own clients as well as
  the server, with what's built into Node, and the loss is, what-
  100ms of IO throughput at 4 requests a second? */
function suggest(apiparams, cb) {
  var req = http.request({
    host: mphost,
    path: url.format({
      pathname: '/api/v0/suggest',
      query: apiparams
    }),
    headers: {
      'User-Agent': useragent
    },
    method: 'POST'
  },function(res){
  })

  req.on('error', function(e) {
    console.log('problem with request: ' + e.message);
  })

  req.end()
}

function wpApiQuery(params, cb) {
  var req = http.request({
    host: wikihost,
    path: url.format({
      pathname: '/w/api.php',
      query: apiparams
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
      cb(res.statusCode,JSON.parse(bodylist.join()))
    })
  })

  req.on('error', function(e) {
    console.log('problem with request: ' + e.message);
  })

  req.end()
}

//Reset the pages data from an API response.
function populatePagesArray(code, body) {
  //i should probably check if the code is 200 but
  pages = body.query.embeddedin
  eicontinue = body['query-continue'].embeddedin.eicontinue
}

//Searches the content of an "External links" section
//for the template and makes a suggestion if found.
function searchElContent(title,content) {
  var match = content.match(templates[targetTemplate].regex)
  if(match) {
    var wpSuggestion = {
      host: wikihost,
      path: '/wiki/' + encodeURIComponent(title.replace(' ','_'))
    }
    var targetSuggestion = {
      host: templates[targetTemplate].hostname,
      path: templates[targetTemplate].path(match)
    }
    suggestion.notes='WELP ' + title
      +'\nCapture: ' + match[0]

    var parend = title.match(/^(.*) \((.*)\)$/)
    if(parend){
      var scope = parend[2]
      //Easy way to knock out MANY of these scope parentheticals
      if(scope.match(/film$/)){
        wpSuggestion.scope = scope
        wpSuggestion.topic = parend[1]
        targetSuggestion.scope = scope
        targetSuggestion.topic = parend[1]
      } else {
        //I'll probably delete the paren in the title in revision,
        //but it might be part of the name in which case I'll delete the scope
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
    console.log('WELP:NOTT '+page.title)
  }
}

function queryPage(page) {
  console.log('Querying '+page.title+'...')
  wpApiQuery({
    action: 'parse',
    prop: 'sections',
    page: page.title,
    format: 'json'
  }, function(pbody) {
    //search backwards through the sections to find the 'External links'
    //(backwards because it's usually the last section)
    var i = pbody.parse.sections.length - 1;
    while(i >= 0 &&
      //Techncally the case should always be "External links",
      //but why be sensitive?
      pbody.parse.sections[i].line.lower() != "external links") --i;

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
        titles: page.title,
        format: 'json'
      }, function(rbody) {
        searchElContent(page.title,
          //The object with the revisions is identified by the pageid.
          //Since it's going to be the only key in the query's pages,
          //I'm going with this.
          rbody.query.pages[Object.keys(rbody.query.pages)[0]].revisions[0])
      })

    //If we ran through all the sections and went past the beginning
    } else {
      console.log('WELP:NOEL '+page.title)
    }
  })
}

function timer_cb() {
  //If we've run through all the pages we have and there are still more
  if((curpage == pages.length && eicontinue) || pages.length == 0) {

    //Query the API for the next group of pages
    console.log('Querying API for next group of pages ('+eicontinue+')...')

    var apiparams = {
      action: 'query',
      list: 'embeddedin',
      eititle: targetTemplate,
      // last I checked, the largest limit Wikipedia
      // is comfortable with is 500, which is plenty
      eilimit: 500,
      format: 'json'
    }

    if(eicontinue) apiparams.eicontinue = eicontinue

    wpApiQuery(apiparams, populatePagesArray);

  //Otherwise, if we're still parsing the current batch
  //(not done or waiting for the next batch of pages)
  } else if(curpage < pages.length) {
    queryPage(pages[curpage++]);
  // Otherwise, if we're done
  // (the previous condition falling through
  // indicates curpage == pages.length,
  // and the last query didn't have any more continuation tokens)
  } else if(!continuetoken) {
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
  if(process.argv[3]){}
  timerId = setInterval(timer_cb,250)
}

