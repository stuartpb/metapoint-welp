var mongodb = require('mongodb')

var useragent = 'Metapoint-WikipediaExternalLinkParser/0.1 (http://github.com/stuartpb/metapoint-welp; stuart@testtrack4.com)'

var templates = {
  //the case insensitivity is to handle the majority of redirect cases
  'IMDb_title': {
    regex: /{{IMDb[ _]title\|(\d*)\|?(.*)}}/i,
    hostname: 'www.imdb.com',
    path: {return '/title/tt'+'0000000'.slice(idnum.length,7)+idnum}
  },
  'IMDb_name': {
    regex: /{{IMDb[ _]name|(\d*)|?(.*)}}/i,
    hostname: 'www.imdb.com',
    path: {return '/name/nm'+'0000000'.slice(idnum.length,7)+idnum}
  }
}

//Returns a callback that sets up the response object
//to gather the body then call a callback when finished.
function callWithBody(cb){
  return function(res){
    var bodylist = []
    res.on('data', function (chunk) {
      bodylist.push(chunk)
    })
    res.on('end', function(){
      cb(res.statusCode,bodylist.join())
    })
  }
}

var targetTemplate = process.argv[1]

var pages = []
var eicontinue
var curpage = 0
var timerId

//Reset the pages data from an API response.
function populatePagesArray(code, body) {
  //i should probably check if the code is 200 but
  body = JSON.parse(body)
  pages = body.query.embeddedin
  eicontinue = body['query-continue'].embeddedin.eicontinue
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

    var req = http.request({
      host: 'en.wikipedia.org',
      path: url.format({
        pathname: '/w/api.php',
        query: apiparams
      },
      headers: {
        'User-Agent': useragent
      })
    },callWithBody(populatePagesArray))

    req.on('error', function(e) {
      console.log('problem with request: ' + e.message);
    })

    req.end()
  //Otherwise, if we're still parsing the current batch
  //(not done or waiting for the next batch of pages)
  } else if(curpage < pages.length) {
    queryPage(curpage++);
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

