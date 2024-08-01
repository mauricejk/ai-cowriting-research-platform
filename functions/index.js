// Initialize functions
const headers = {
  "Authorization": "... REFERENCE YOUR API KEY HERE ...", // e.g. defineSecret('OPEN_AI_API_KEY')
};

const functions = require("firebase-functions");
const admin = require('firebase-admin');
const englishWords = require('an-array-of-english-words');

const suggestionModeSelection = {
  tokenMode: {
    tokenLimit : 30
  },
  requestMode: {
    tokenLimit : 20
}
}

//Dynamic import of getgot -- turn on when normal import doesn't work
const getgot = async () => {
  const got = await import('got');
  return got.default;
}

function isPunctuation(char) {
  return /[~`!#$%\^&*+=\-\[\]\\';,/{}|\\":<>\?]/g.test(char);
}

function checkWords(string1, string2) {
  let string_1_last = string1.split(' ').pop();
  let string_2_first = string2.split(' ')[0];
  let combined_word = string_1_last + string_2_first;
  console.log('last char:', string1.slice(-1), 'ispunct:', isPunctuation(string1.slice(-1)))

  if ((!englishWords.includes(combined_word) &&
      (englishWords.includes(string_1_last) || englishWords.includes(string_2_first)))) {
    string2 = ' ' + string2;
  } else if (string1.slice(-1) === '.' || string1.slice(-1) === '!' || string1.slice(-1) === '?' || isPunctuation(string1.slice(-1))) {
    string2 = ' ' + string2;
  } else {
    string2 = string2;
  }
  return string2;
}

// Generation continuation using chat completion engine (GPT-3.5-turbo)
exports.generateTurbo = functions.https.onRequest(async (request, response) => {
  const got = await getgot(); // -- turn on when normal import doesn't work
  // Prepare prompt
  var text = request.query.editorText;
  if (request.query.currentSuggestion != "") {
    text = request.query.currentSuggestion; // Extend current suggestion
  }

  var systemPrompt = request.query.systemPrompt;
  var suggestionMode  = request.query.suggestionMode || 'requestMode';

  // Prepare request
  (async () => {
    const endpoint = "https://api.openai.com/v1/chat/completions";
    const params = {
      //https://beta.openai.com/docs/engines
      "model": "gpt-4",
      "messages": [{
          "role": "system",
          "content": systemPrompt
        },
        {
          "role": "user",
          "content": text
        }
      ],
      "max_tokens": suggestionModeSelection[suggestionMode || 'requestMode'].tokenLimit,
      "temperature": parseFloat(request.query.generationTemperature),
      "frequency_penalty": 1,
      "presence_penalty": 1,
      "logit_bias": {
        "90": -100,
        "1391": -100,
        "1782": -100,
        "92": -100, // { amd { with space
        "198": -100,
        "628": -100, // New lines and double new lines
        "16": -100, // 1 to prevent lists
        "62": -100,
        "834": -100,
        "17569": -100,
        "1427": -100,
        "29343": -100,
        "25947": -100,
        "37405": -100,
        "2602": -100, // underscore placeholders
        "9": -100,
        "1174": -100,
        "8162": -100,
        "2466": -100,
        "35625": -100,
        "4557": -100,
        "46068": -100 // star placeholders
      }
    };

    try {
      // Send request and process response
      var apiRequestTime = new Date();
      const apiResponse = await got.post(endpoint, {
        json: params,
        headers: headers
      }).json();

      // Parse response
      var generationOnly = apiResponse.choices[0].message.content;

      // If genetaionOnly contains '*****', set generationOnly to empty string
      if(generationOnly.startsWith('*****')) {
        generationOnly = '';
      }
      // console.log({generationOnly})
      generationOnly = generationOnly.replaceAll('*****', '');
      // console.log({
      //   generationOnly
      // })

      if(generationOnly !== '') {
      generationOnly = generationOnly.replace('  ', ' '); // Remove double spaces
      generationOnly = checkWords(text, generationOnly);
      }

      var responseData = {
        "generatedText": generationOnly,
        "newSuggestion": text + generationOnly,
        "processingTime": (new Date() - apiRequestTime) / 1000,
        // "debugging": generationWithPrompt,
      }
      response.set("Access-Control-Allow-Origin", "*");
      response.send(responseData);

      // Log result and save to firebase
      responseData.editorText = request.query.editorText;
      responseData.editorTextFormatted = request.query.editorTextFormatted;
      responseData.pastSuggestion = request.query.currentSuggestion;
      responseData.participantGroup = request.query.participantGroup;
      responseData.systemPrompt = request.query.systemPrompt;
      // responseData.generationPrefix = request.query.generationPrefix;
      // responseData.generationInfix = request.query.generationInfix;
      responseData.generationTemperature = request.query.generationTemperature;
      responseData.sessionID = request.query.sessionID;

      !admin.apps.length ? admin.initializeApp() : admin.app();
      const db = admin.firestore();
      db.collection('logs').doc(request.query.studyName).collection(request.query.participantID).doc(request.query.elapsedTime + '-gen').set(responseData);
    } catch (err) {
      functions.logger.error("API error:", request.query, params, err);
    }
  })();
});
// // Generation continuation using text completion engine (GPT-3.5-instruct)
exports.generate = functions.https.onRequest(async (request, response) => {
  const got = await getgot(); // -- turn on when normal import doesn't work
  // Prepare prompt
  var suggestionMode  = request.query.suggestionMode || 'requestMode';
  var text = request.query.editorText;
  if (request.query.currentSuggestion != "") {
    text = request.query.currentSuggestion; // Extend current suggestion
  }
  // Insert infix between text and last sentence
  var lastSentenceIndex = Math.max(text.lastIndexOf('.'), text.lastIndexOf('!'), text.lastIndexOf('?'));
  if (lastSentenceIndex <= 0) { // No previous sentence
    var prompt = request.query.generationPrefix + text;
  } else {
    var preInfix = text.slice(0, lastSentenceIndex + 1);
    var postInfix = text.slice(lastSentenceIndex + 1);
    var prompt = request.query.generationPrefix + preInfix + request.query.generationInfix + postInfix;
  }

  // Prepare request with
  (async () => {
    const endpoint = "https://api.openai.com/v1/engines/gpt-3.5-turbo-instruct/completions"
    const params = {
      //https://beta.openai.com/docs/engines
      "prompt": prompt,
      "max_tokens": suggestionModeSelection[suggestionMode||'requestMode'].tokenLimit,
      "temperature": parseFloat(request.query.generationTemperature),
      "frequency_penalty": 1,
      "presence_penalty": 1,
      "logit_bias": {
        "90": -100,
        "1391": -100,
        "1782": -100,
        "92": -100, // { amd { with space
        "198": -100,
        "628": -100, // New lines and double new lines
        "16": -100, // 1 to prevent lists
        "62": -100,
        "834": -100,
        "17569": -100,
        "1427": -100,
        "29343": -100,
        "25947": -100,
        "37405": -100,
        "2602": -100, // underscore placeholders
        "9": -100,
        "1174": -100,
        "8162": -100,
        "2466": -100,
        "35625": -100,
        "4557": -100,
        "46068": -100 // star placeholders
      }
    };

    try {
      // Send request and process response
      var apiRequestTime = new Date();
      const apiResponse = await got.post(endpoint, {
        json: params,
        headers: headers
      }).json();

      // Parse response
      var generationWithPrompt = `${prompt}${apiResponse.choices[0].text}`;
      var generationOnly = generationWithPrompt.substring(prompt.length);
      generationOnly = generationOnly.replace(/\s\s+/g, ' '); // Remove double spaces
      if (text == "" || text.endsWith(' ')) {
        generationOnly = generationOnly.trim(); // Avoid double spaces at beginning
      }
      var responseData = {
        "generatedText": generationOnly,
        "newSuggestion": text + generationOnly,
        "processingTime": (new Date() - apiRequestTime) / 1000,
        // "debugging": generationWithPrompt,
      }
      response.set("Access-Control-Allow-Origin", "*");
      response.send(responseData);

      // Log result and save to firebase
      responseData.editorText = request.query.editorText;
      responseData.editorTextFormatted = request.query.editorTextFormatted;
      responseData.pastSuggestion = request.query.currentSuggestion;
      responseData.participantGroup = request.query.participantGroup;
      responseData.generationPrefix = request.query.generationPrefix;
      responseData.generationInfix = request.query.generationInfix;
      responseData.generationTemperature = request.query.generationTemperature;
      responseData.sessionID = request.query.sessionID;

      !admin.apps.length ? admin.initializeApp() : admin.app();
      const db = admin.firestore();
      db.collection('logs').doc(request.query.studyName).collection(request.query.participantID).doc(request.query.elapsedTime + '-gen').set(responseData);
    } catch (err) {
      functions.logger.error("API error:", request.query, params, err);
    }
  })();
});

// Save session logs
exports.savelogs = functions.https.onRequest((request, response) => {
  try {
    var logData = {
      "elapsedTime": request.query.elapsedTime,
      "participantGroup": request.query.participantGroup,
      "editorTextFormatted": request.query.editorTextFormatted,
      "editorInteractionLog": request.query.editorInteractionLog,
      "sessionID": request.query.sessionID,
    };

    // Save logs to firestore
    !admin.apps.length ? admin.initializeApp() : admin.app();
    const db = admin.firestore();
    db.collection('logs').doc(request.query.studyName).collection(request.query.participantID).doc(request.query.elapsedTime + '-log').set(logData);

    response.set("Access-Control-Allow-Origin", "*");
    response.send({
      'logging': 'successful'
    });
  } catch (err) {
    functions.logger.error("Logging error:", request.query, err);
  }
});
