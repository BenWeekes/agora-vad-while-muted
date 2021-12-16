// create Agora client
var client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

var localTracks = {
  videoTrack: null,
  audioTrack: null,
};
var audioTrackVAD= null;

var localTrackState = {
  videoTrackMuted: false,
  audioTrackMuted: false
}

var remoteUsers = {};
// Agora client options
var options = {
  appid: null,
  channel: null,
  uid: null,
  token: null
};

// the demo can auto join channel with params in url
$(() => {
  var urlParams = new URL(location.href).searchParams;
  options.appid = urlParams.get("appid");
  options.channel = urlParams.get("channel");
  options.token = urlParams.get("token");
  options.uid = urlParams.get("uid");
  if (options.appid && options.channel) {
    $("#uid").val(options.uid);
    $("#appid").val(options.appid);
    $("#token").val(options.token);
    $("#channel").val(options.channel);
    $("#join-form").submit();
  }

})

$("#join-form").submit(async function (e) {
  e.preventDefault();
  $("#join").attr("disabled", true);
  try {
    options.appid = $("#appid").val();
    options.token = $("#token").val();
    options.channel = $("#channel").val();
    options.uid = Number($("#uid").val());
    await join();
    if(options.token) {
      $("#success-alert-with-token").css("display", "block");
    } else {
      $("#success-alert a").attr("href", `index.html?appid=${options.appid}&channel=${options.channel}&token=${options.token}`);
      $("#success-alert").css("display", "block");
    }
  } catch (error) {
    console.error(error);
  } finally {
    $("#leave").attr("disabled", false);
  }
});

$("#leave").click(function (e) {
  leave();
});

$("#mute-audio").click(function (e) {
  if (!localTrackState.audioTrackMuted) {
    muteAudio();
  } else {
    unmuteAudio();
  }
});

$("#mute-video").click(function (e) {
  if (!localTrackState.videoTrackMuted) {
    muteVideo();
  } else {
    unmuteVideo();
  }
})

async function join() {
  // add event listener to play remote tracks when remote users join, publish and leave.
  client.on("user-published", handleUserPublished);
  client.on("user-joined", handleUserJoined);
  client.on("user-left", handleUserLeft);

  var gumStream=await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

  // join a channel and create local tracks, we can use Promise.all to run them concurrently
  [ options.uid, localTracks.audioTrack, localTracks.videoTrack ] = await Promise.all([
    // join the channel
    client.join(options.appid, options.channel, options.token || null, options.uid || null),
    // create local tracks, using microphone and camera
    //AgoraRTC.createMicrophoneAudioTrack(),
    AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: gumStream.getAudioTracks()[0] }),
    //AgoraRTC.createCameraVideoTrack()
    AgoraRTC.createCustomVideoTrack({ mediaStreamTrack: gumStream.getVideoTracks()[0] })
  ]);

  showMuteButton();
  
  // play local video track
  localTracks.videoTrack.play("local-player");
  $("#local-player-name").text(`localVideo(${options.uid})`);

  // publish local tracks to channel
  await client.publish(Object.values(localTracks));
  console.log("publish success");
  setupVAD(gumStream.clone());
  //enableVAD();

}

async function leave() {
  for (trackName in localTracks) {
    var track = localTracks[trackName];
    if(track) {
      track.stop();
      track.close();
      localTracks[trackName] = undefined;
    }
  }

  // remove remote users and player views
  remoteUsers = {};
  $("#remote-playerlist").html("");

  // leave the channel
  await client.leave();

  $("#local-player-name").text("");
  $("#join").attr("disabled", false);
  $("#leave").attr("disabled", true);
  hideMuteButton();
  console.log("client leaves channel success");
}

async function subscribe(user, mediaType) {
  const uid = user.uid;
  // subscribe to a remote user
  await client.subscribe(user, mediaType);
  console.log("subscribe success");

  // if the video wrapper element is not exist, create it.
  if (mediaType === 'video') {
    if ($(`#player-wrapper-${uid}`).length === 0) {
      const player = $(`
        <div id="player-wrapper-${uid}">
          <p class="player-name">remoteUser(${uid})</p>
          <div id="player-${uid}" class="player"></div>
        </div>
      `);
      $("#remote-playerlist").append(player);
    }

    // play the remote video.
    user.videoTrack.play(`player-${uid}`);
  }
  if (mediaType === 'audio') {
    user.audioTrack.play();
  }
}

function handleUserJoined(user) {
  const id = user.uid;
  remoteUsers[id] = user;
}

function handleUserLeft(user) {
  const id = user.uid;
  delete remoteUsers[id];
  $(`#player-wrapper-${id}`).remove();
}

function handleUserPublished(user, mediaType) {
  subscribe(user, mediaType);
}

function hideMuteButton() {
  $("#mute-video").css("display", "none");
  $("#mute-audio").css("display", "none");
}

function showMuteButton() {
  $("#mute-video").css("display", "inline-block");
  $("#mute-audio").css("display", "inline-block");
}

async function muteAudio() {
  if (!localTracks.audioTrack) return;
  /**
   * After calling setMuted to mute an audio or video track, the SDK stops sending the audio or video stream. Users whose tracks are muted are not counted as users sending streams.
   * Calling setEnabled to disable a track, the SDK stops audio or video capture
   */
  await localTracks.audioTrack.setMuted(true);
  localTrackState.audioTrackMuted = true;
  $("#mute-audio").text("Unmute Audio");
}

async function muteVideo() {
  if (!localTracks.videoTrack) return;
  await localTracks.videoTrack.setMuted(true);
  localTrackState.videoTrackMuted = true;
  $("#mute-video").text("Unmute Video");
}

async function unmuteAudio() {
  if (!localTracks.audioTrack) return;
  await localTracks.audioTrack.setMuted(false);
  localTrackState.audioTrackMuted = false;
  $("#mute-audio").text("Mute Audio");
}

async function unmuteVideo() {
  if (!localTracks.videoTrack) return;
  await localTracks.videoTrack.setMuted(false);
  localTrackState.videoTrackMuted = false;
  $("#mute-video").text("Mute Video");
}


function getMicLevel() {
      var analyser = audioTrackVAD._source.analyserNode;
      const bufferLength = analyser.frequencyBinCount;
      var data = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(data);
      var values = 0;
      var average;
      var length = data.length;
      for (var i = 0; i < length; i++) {
          values += data[i];
      }
      average = Math.floor(values / length);
      return average;
}



function setupVAD(stream){

  var MaxAudioSamples=400;
  var MaxBackgroundNoiseLevel=30;
  var SilenceOffeset=10;
  var audioSamplesArr=[];
  var audioSamplesArrSorted=[];
  var exceedCount=0;
  var exceedCountThreshold=4;

  var audioContext = new AudioContext();
  var analyser = audioContext.createAnalyser();
  var microphone = audioContext.createMediaStreamSource(stream);
  var javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

  analyser.smoothingTimeConstant = 0.3;
  analyser.fftSize = 1024;
  microphone.connect(analyser);
  analyser.connect(javascriptNode);

  javascriptNode.connect(audioContext.destination);
  javascriptNode.onaudioprocess = function() {
      var array = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(array);
      var values = 0;

      var length = array.length;
      for (var i = 0; i < length; i++) {
        values += (array[i]);
      }

      var audioLevel = Math.floor(values / length);
      console.log(audioLevel);
      if (audioLevel<=MaxBackgroundNoiseLevel) {
         if (audioSamplesArr.length >= MaxAudioSamples) {
            var removed = audioSamplesArr.shift();
            var removedIndex = audioSamplesArrSorted.indexOf(removed);
            if (removedIndex>-1) {
               audioSamplesArrSorted.splice(removedIndex, 1);
            }
         }
         audioSamplesArr.push(audioLevel);
         audioSamplesArrSorted.push(audioLevel);
         audioSamplesArrSorted.sort((a, b) => a - b);
      }
      var background = Math.floor(3 * audioSamplesArrSorted[Math.floor(audioSamplesArrSorted.length / 2)] / 2);
      if (audioLevel>background+SilenceOffeset) {
         exceedCount++;
      } else {
         exceedCount=0;
      }
      $('#mic-activity').html("Direct getVol  "+audioLevel);
      $('#background-noise').html("Background level  "+background);
      $('#exceed').html("exceedCount  "+exceedCount);
      if (exceedCount>exceedCountThreshold) {
         $('#vad').html("VOICE DETECTED");
      } else {
         $('#vad').html("");
      }
      console.log(audioSamplesArrSorted.length+" "+audioSamplesArrSorted);
  }
}

function enableVAD() {

        var analyser = audioTrackVAD._source.analyserNode;
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = .3;

        var MaxAudioSamples=400;
        var MaxBackgroundNoiseLevel=30;
        var SilenceOffeset=10;
        var audioSamplesArr=[];
        var audioSamplesArrSorted=[];
        var exceedCount=0;
        var exceedCountThreshold=4;

        setInterval(() => {
                if (!audioTrackVAD)
                        return;

                //$('#mic-activity-agora').html("Agora getVol: "+Math.floor(audioTrackVAD.getVolumeLevel()*60));
                audioLevel=getMicLevel();
                if (audioLevel<=MaxBackgroundNoiseLevel) {
                        if (audioSamplesArr.length >= MaxAudioSamples) {
                                        var removed = audioSamplesArr.shift();
                                        var removedIndex = audioSamplesArrSorted.indexOf(removed);
                                        if (removedIndex>-1) {
                                                        audioSamplesArrSorted.splice(removedIndex, 1);
                                        }
                        }
                        audioSamplesArr.push(audioLevel);
                        audioSamplesArrSorted.push(audioLevel);
                        audioSamplesArrSorted.sort((a, b) => a - b);
                }
                var background = Math.floor(3 * audioSamplesArrSorted[Math.floor(audioSamplesArrSorted.length / 2)] / 2);
                if (audioLevel>background+SilenceOffeset) {
                        exceedCount++;
                } else {
                        exceedCount=0;
                }
                $('#mic-activity').html("Direct getVol  "+audioLevel);
                $('#background-noise').html("Background level  "+background);
                $('#exceed').html("exceedCount  "+exceedCount);
                if (exceedCount>exceedCountThreshold) {
                        $('#vad').html("VOICE DETECTED");
                } else {
                        $('#vad').html("");
                }
                console.log(audioSamplesArrSorted.length+" "+audioSamplesArrSorted);
          }, 100);
}

