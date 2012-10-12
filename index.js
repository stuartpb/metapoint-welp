var mongodb = require('mongodb')

var useragent = 'Metapoint-WikipediaExternalLinkParser/0.1 (http://github.com/stuartpb/metapoint-welp; stuart@testtrack4.com)'

function imdbTemplate(type,abbr) {
  return {
    regex: RegExpObject.compile(
      '{{IMDb[ _]'+type+'\\|(\\d*)\\|?(.*)}}',
      //the case insensitivity is to handle the majority of redirect cases
      'i'),
    hostname: 'www.imdb.com',
    path: function(match) {
      return '/'+type+'/'abbr+'0000000'.slice(match[1].length,7)+idnum
    }
  }
}

var templates = {
  'IMDb_title': imdbTemplate('title','tt'),
  'IMDb_name': imdbTemplate('name','nm')
}

var targetTemplate = process.argv[1]

var pages = []
var eicontinue
var curpage = 0
var timerId

function wpApiQuery(params, cb) {
  var req = http.request({
    host: 'en.wikipedia.org',
    path: url.format({
      pathname: '/w/api.php',
      query: apiparams
    },
    headers: {
      'User-Agent': useragent
    })
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

}

function queryPage(page) {
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
        titles = page.title,
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
  }
}

function timer_cb() {
  //If we've run through all the pages we have and there are still more
  if((curpage == pages.length && continuetoken) || pages.length = 0) {

    //Query the API for the next group of pages
    console.log('Querying API for next group of pages...')

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
  error('This script must be run with a target template as a parameter.')
} else if (!(targetTemplate in templates)) {
  error('Target template "'+target+'" not found')
} else {
  console.log('Getting pages for "'+targetTemplate'"...')
  timerId = setInterval(timer_cb,250)
}

