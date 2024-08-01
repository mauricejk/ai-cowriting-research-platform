// For connecting to the cloud backend
var backend = "https://us-central1-YOUR-PROJECT-NAME.cloudfunctions.net/" // Cloud backend
// For connecting to a local backend (comment out to always use cloud backend)
if (!location.hostname || location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  var backend = "http://localhost:5001/YOUR-PROJECT-NAME/us-central1/" // Local backend
}
console.log('Backend:', backend);

// Global variables (more from parent)
const Delta = Quill.import('delta');
const Clipboard = Quill.import('modules/clipboard');

var interactionLog = new Map();
var firstInteraction = new Date();
var lastRequestTime = new Date();
var sessionID = Math.random().toString(36).substring(7);

var suggestedText = "";
var acceptedSuggestions = 0;
var requestedSuggestions = 0;
var suggestionsVisibleTime = 0;
var extensionRequestCount = 0;
var submissionAttempts = 0;
var suggestionsDisabled = participantGroup.includes("control") || participantID.includes("${e://Field");
var systemPrompt;

// Initialize editor and suggestion fields
console.log('Initializing editor..')
class DisabledClipboard extends Clipboard {
  onPaste(e) {
    e.preventDefault();
    console.log('Prevented pasting.')
  }
}
Quill.register('modules/clipboard', DisabledClipboard, true);

var editorWriting = new Quill('#editor-writer', {});
var editorSuggestion = new Quill('#editor-suggestions', {});
editorSuggestion.enable(false); // Disable edits in preview
if (suggestionsDisabled) {
  // Hiding suggestions
  console.log('Disabling suggestions.')
  $("#editor-suggestions").hide();
  $("#loader").css({
    opacity: 0
  });
}

// Helper functions
function getElapsedTime() {
  return new Date() - firstInteraction;
}

function getEditorText() {
  return editorWriting.getText().slice(0, -1); // remove the /n at the end
}

function getEditorTextFormatted() {
  var formattedText = ""
  editorWriting.getContents().forEach((item, index) => {
    if ('attributes' in item && 'underline' in item.attributes) {
      formattedText += "<u>" + item.insert + "</u>"
    } else if ('insert' in item) {
      formattedText += item.insert;
    }
  });
  return formattedText.slice(0, -1);
}

// Monitor text changes
editorWriting.on('text-change', (delta, oldDelta, source) => {
  lastInteraction = new Date();
  // Add interaction to log
  interactionLog.set(getElapsedTime(), delta['ops']);
  // Check if current suggestion is still valid
  if (!suggestedText.startsWith(getEditorText())) {
    console.log("Suggestion was invalidated.")
    resetSuggestions();
  } // Invalidate suggestion on user deletes
  else if ('delete' in delta['ops'][0] || delta['ops'].length > 1 && 'delete' in delta['ops'][1]) {
    console.log("Suggestion was deleted.")
    resetSuggestions();
  }
  if (editorWriting.getFormat().hasOwnProperty("underline")) {
    editorWriting.format('underline', false);
  }
});

editorWriting.on('selection-change', function (range, oldRange, source) {
  if (editorWriting.getFormat().hasOwnProperty("underline")) {
    console.log('Selection change: updating formatting.')
    editorWriting.format('underline', false);
  }
});

// Accept suggested word
function acceptSuggestion() {
  if (suggestionsDisabled) {
    console.log('Suggestions are not enabled.')
    return;
  }
  acceptedSuggestions += 1;
  var visibleSuggestion = editorSuggestion.getText(getEditorText().length);
  // Add potential white space, but don't underline
  if (visibleSuggestion.startsWith(' ')) {
    editorWriting.updateContents(new Delta()
      .retain(getEditorText().length)
      .insert(" "));
  }
  // Add next word and underline
  editorWriting.updateContents(new Delta()
    .retain(getEditorText().length)
    .insert(visibleSuggestion.trim().split(' ')[0], {
      underline: true
    })
  );
  // Move cursor behind the inserted word and remove formatting
  editorWriting.setSelection(getEditorText().length);
  if (editorWriting.getFormat().hasOwnProperty("underline")) {
    editorWriting.format('underline', false);
  }
}

// Make generation visible letter by letter
function revealSuggestion(timePassed = 0) {
  try {
    var suggestionModeCheck = suggestionMode;
  }
  catch{
    var suggestionModeCheck = 'requestMode';
  };
  if (suggestedText != "") {
    suggestionsVisibleTime += timePassed;
    var currentlyVisibleSuggestion = editorSuggestion.getText();
    // If no suggestion is shown, display suggestion up to user text
    if (currentlyVisibleSuggestion.trim().length == 0) {
      editorSuggestion.setContents(getEditorText());
      currentlyVisibleSuggestion = getEditorText();
    }
    // Display one further character
    if (currentlyVisibleSuggestion.length <= suggestedText.length) {
      const textToInsert = suggestedText.substring(0, currentlyVisibleSuggestion.length + 1); //.replace('\n', ' ')
      editorSuggestion.setContents(new Delta().insert(textToInsert, {
        color: 'grey'
      }));
    }
    // Request new generation if suggestion is fully shown and it is less than two sentences
    if (suggestionModeCheck == 'requestMode'){
      var reachedSuggestionEnd = currentlyVisibleSuggestion.length == suggestedText.length;
      var suggestedWordCount = suggestedText.slice(getEditorText().length).split(' ').length;
      var lastSentenceIndex = Math.max(suggestedText.lastIndexOf('.'), suggestedText.lastIndexOf('!'), suggestedText.lastIndexOf('?'));
      if (reachedSuggestionEnd && extensionRequestCount == 0 && suggestedWordCount < 30 || lastSentenceIndex <= getEditorText().length) {
        if (!$("#loader").is(":visible")) {
          console.log('Extending continuation.')
          extensionRequestCount += 1;
          if (systemPrompt === undefined) {
            requestNewSuggestion();
          } else {
            requestNewSuggestionTurbo(); // Use GPT-3.5-turbo
          }
        }
      }
    }
  }
}

// Backend connection
function resetSuggestions() {
  // console.log("Resetting suggestions.")
  suggestedText = "";
  editorSuggestion.setContents("");
  extensionRequestCount = 0;
  setTimeout(triggerDelayedGeneration, 400);
}

// triggerDelayedGeneration originally 750; currently 400
function triggerDelayedGeneration() {
  if ((new Date() - lastInteraction) >= 400) {

    if (systemPrompt === undefined) {
      console.log({
        generationInfix
      }, {
        generationPrefix
      })
      requestNewSuggestion();
    } else {
      console.log({
        systemPrompt
      })
      requestNewSuggestionTurbo(); // Use GPT-3.5-turbo
    }
  } else {
    // console.log("Dropping request as newer changes are available.")
  }
}

// Request new generation from server using GPT-3.5-turbo
//requestNewSuggestionTurbo orignally 500; currently 200
function requestNewSuggestionTurbo() {

  try {
    var suggestionModeCheck = suggestionMode;
  }
  catch{
    var suggestionModeCheck = 'requestMode';
  };

  if (suggestionsDisabled || requestedSuggestions > 200) {
    return;
  }
  $("#loader").show();
  requestedSuggestions += 1;
  var requestTime = new Date();
  requestData = {
    studyName: studyName,
    elapsedTime: getElapsedTime(),
    participantID: participantID,
    sessionID: sessionID,
    participantGroup: participantGroup,
    editorText: getEditorText(),
    editorTextFormatted: getEditorTextFormatted(),
    currentSuggestion: suggestedText,
    generationTemperature: generationTemperature,
    suggestionMode: suggestionModeCheck,
    // generationPrefix: generationPrefix,
    // generationInfix: generationInfix
    systemPrompt: systemPrompt,
  };

  console.log('Sending generation request', requestedSuggestions + ".");

  $.getJSON(backend + "generateTurbo", requestData,
    function (responseData) {
      console.log("Received generationTurbo response:", responseData, (new Date() - requestTime) / 1000)
      $("#loader").hide();
      if (!responseData["newSuggestion"].startsWith(getEditorText())) {
        console.log('Generation did not match editor text.');
      } else if (suggestedText != "" && !responseData["newSuggestion"].startsWith(suggestedText)) {
        console.log("Generation did not match active suggestion.")
      } else if (responseData["generatedText"] == "" || responseData["generatedText"].startsWith('..') || responseData["generatedText"].startsWith('…')) {
        console.log("Incomplete generation issue.")
      } else {
        // console.log('Inserting generation.');
        suggestedText = responseData["newSuggestion"];
        console.log('Inserting generation:' + suggestedText);
        revealSuggestion();
        interactionLog.set(getElapsedTime(), [{
          "suggest": responseData["newSuggestion"]
        }]);
      }
    });
}

// Request new generation from server
function requestNewSuggestion() {
  if (suggestionsDisabled || requestedSuggestions > 500) {
    return;
  }
  $("#loader").show();
  requestedSuggestions += 1;
  var requestTime = new Date();
  requestData = {
    studyName: studyName,
    elapsedTime: getElapsedTime(),
    participantID: participantID,
    sessionID: sessionID,
    participantGroup: participantGroup,
    editorText: getEditorText(),
    editorTextFormatted: getEditorTextFormatted(),
    currentSuggestion: suggestedText,
    generationTemperature: generationTemperature,
    generationPrefix: generationPrefix,
    generationInfix: generationInfix
  };

  console.log('Sending generation request', requestedSuggestions + ".");

  $.getJSON(backend + "generate", requestData,
    function (responseData) {
      console.log("Received generation response:", responseData, (new Date() - requestTime) / 1000)
      $("#loader").hide();
      if (!responseData["newSuggestion"].startsWith(getEditorText())) {
        console.log('Generation did not match editor text.');
      } else if (suggestedText != "" && !responseData["newSuggestion"].startsWith(suggestedText)) {
        console.log("Generation did not match active suggestion.")
      } else if (responseData["generatedText"] == "" || responseData["generatedText"].startsWith('..') || responseData["generatedText"].startsWith('…')) {
        console.log("Incomplete generation issue.")
      } else {
        console.log('Inserting generation.');
        suggestedText = responseData["newSuggestion"];
        revealSuggestion();
        interactionLog.set(getElapsedTime(), [{
          "suggest": responseData["newSuggestion"]
        }]);
      }
    });
}

// Send update logs to the server
function sendLogs() {
  if (participantID.includes("${e://Field")) {
    return;
  }
  if (interactionLog.size > 0) {
    console.log('Sending logs to server.');
    var logData = {
      studyName: studyName,
      elapsedTime: getElapsedTime(),
      participantID: participantID,
      sessionID: sessionID,
      participantGroup: participantGroup,
      editorTextFormatted: getEditorTextFormatted(),
      editorInteractionLog: JSON.stringify(Object.fromEntries(interactionLog)),
    };
    interactionLog.clear(); // Clear even if no success

    $.getJSON(backend + "savelogs", logData,
      function (responseData) {
        if (!'logging' in responseData) {
          print('Logging error:', responseData);
        }
      });
  }
}



function submitEssay() {
  sendLogs();
  $.getJSON(backend + "post_status", {
    studyName: studyName,
    participantID: participantID,
    sessionID: sessionID,
    participantGroup: participantGroup,
    statusMessage: "Finished writing task."
  });
  parent.postMessage({
    event_id: 'submit',
    data: getEditorTextFormatted(),
    formatted_essay: getEditorTextFormatted(),
    accepted_suggestions: acceptedSuggestions,
    requested_suggestions: requestedSuggestions,
    suggestions_visible_time: suggestionsVisibleTime / 1000
  }, "*");
  console.log("Submitted essay.");
}

function highlightSuggestion() {
  if (acceptedSuggestions == 0) {
    $("#trigger_word").fadeOut(300).fadeIn(500);
  }
}

// Keybindings and interface bindings
editorWriting.keyboard.bindings[9].unshift({ // Tab key, need to fix repetitive presses
  key: 9,
  handler: function (range) {
    // acceptSuggestion();
  }
});

editorSuggestion.keyboard.bindings[9].unshift({ // Tab key
  key: 9,
  handler: function (range) {
    // acceptSuggestion();
  }
});

var tabDown = false;
$(document).keydown(function (e) {
  if (e.key === "Escape") { // escape key maps to keycode `27`
    resetSuggestions();
  }
  if (e.which == 9) {
    if (!tabDown) {
      acceptSuggestion();
      tabDown = true;
    }
  }
});

$(document).keyup(function (e) {
  if (e.which == 9) {
    tabDown = false;
  }
});

// Interface button bindings
$(document).ready(function () {
  $('#trigger_word').click(function () {
    acceptSuggestion();
  });
  // $('#trigger_sentence').click(function() {
  //     useSuggestedSentence();
  // });
  $('#trigger_reset').click(function () {
    resetSuggestions();
  });

  $('#submit_button_top').click(function() {
    var sentenceCount = getEditorText().split(/[.!?]+\s/).filter(Boolean).length;
    // var ellapsedSeconds = getElapsedTime() / 1000;
    // submissionAttempts += 1;
    if (sentenceCount < 5) {
      // if (submissionAttempts > 2) {
      //   console.log("Sending essay to parent:", sentenceCount, getElapsedTime()/1000);
      //   submitEssay();
      //   return;
      // }
      alert('Please write at least 5 sentences. So far, you have written ' + sentenceCount + '.');
    // } else if (ellapsedSeconds < 0) {
    //   console.log('Rushed submission:', getElapsedTime() / 1000);
    //   alert('Please write a thoughtful response. This should take at least a minute.');
    } else {
      console.log("Sending essay to parent:", sentenceCount, getElapsedTime()/1000);
      submitEssay();
    }
  });

  $('#submit_button_bottom').click(function() {
    var sentenceCount = getEditorText().split(/[.!?]+\s/).filter(Boolean).length;
    // var ellapsedSeconds = getElapsedTime() / 1000;
    // submissionAttempts += 1;
    if (sentenceCount < 5) {
      // if (submissionAttempts > 2) {
      //   console.log("Sending essay to parent:", sentenceCount, getElapsedTime()/1000);
      //   submitEssay();
      //   return;
      // }
      alert('Please write at least 5 sentences. So far, you have written ' + sentenceCount + '.');
    // } else if (ellapsedSeconds < 0) {
    //   console.log('Rushed submission:', getElapsedTime() / 1000);
    //   alert('Please write a thoughtful response. This should take at least a minute.');
    } else {
      console.log("Sending essay to parent:", sentenceCount, getElapsedTime()/1000);
      submitEssay();
    }
  });

  $('#submit_button').click(function() {
    var sentenceCount = getEditorText().split(/[.!?]+\s/).filter(Boolean).length;
    // var ellapsedSeconds = getElapsedTime() / 1000;
    // submissionAttempts += 1;
    if (sentenceCount < 5) {
      // if (submissionAttempts > 2) {
      //   console.log("Sending essay to parent:", sentenceCount, getElapsedTime()/1000);
      //   submitEssay();
      //   return;
      // }
      alert('Please write at least 5 sentences. So far, you have written ' + sentenceCount + '.');
    // } else if (ellapsedSeconds < 0) {
    //   console.log('Rushed submission:', getElapsedTime() / 1000);
    //   alert('Please write a thoughtful response. This should take at least a minute.');
    } else {
      console.log("Sending essay to parent:", sentenceCount, getElapsedTime()/1000);
      submitEssay();
    }
  });

  $('#model_select').change(function () {
    participantGroup = $(this).val();
    if (systemPrompt === undefined) {
      generationPrefix = introduction + generationPrefixes[participantGroup];
      generationInfix = generationInfixes[participantGroup];
      systemPrompt = undefined;
    } else {
      systemPrompt = systemPrompts[participantGroup];
      generationPrefix = undefined;
      generationInfix = undefined;
    }
    console.log('Changed model to:', participantGroup);
    resetSuggestions();
  });
});

// Start process
editorWriting.setContents(new Delta().insert(editorInitialText, {}));
editorWriting.setSelection(getEditorText().length);
setInterval(sendLogs, 5000);
setInterval(highlightSuggestion, 4000);

(function loop() {
  if (Math.random() > 0.75) {
    var wait = 100;
  } else {
    var wait = 15;
  }
  setTimeout(function () {
    revealSuggestion(wait);
    loop();
  }, wait);
}());

setTimeout(() => {
  $.getJSON(backend + "post_status", {
    studyName: studyName,
    participantID: participantID,
    sessionID: sessionID,
    participantGroup: participantGroup,
    statusMessage: "Started writing task."
  });
  console.log('Posting status..')
}, 500)
