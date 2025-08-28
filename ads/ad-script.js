// fullscreen-ad.js
// Updated to:
// 1. Support inline CSS and HTML (<p>, <br>) in cta.message using innerHTML.
// 2. Customize "Go" button with cta.buttonText and hide if cta.link is '#'.
// 3. Preserve video skip button (replay or after ad.duration), CTA on video end/skip, image restart, video rewind, media loading, etc.
// 4. Use adState as single source of truth.

(function() {
  // Generate a random prefix for classes and IDs to avoid conflicts
  const prefix = 'fsad_' + Math.random().toString(36).substring(2, 10);

  // Single source of truth for ad state
  const adState = {
    soundActivated: false,
    isPaused: false,
    pauseStartTime: null,
    elapsedBeforePause: 0,
    animationFrameId: null,
    currentIndex: null,
    currentMedia: null,
    currentDuration: 0,
    currentCallback: null,
    isReplay: false,
    videoEnded: false,
    skipButton: null
  };

  // Create and inject styles with prefixed classes
  const style = document.createElement('style');
  style.innerHTML = `
    .${prefix}-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 999999;
      background-color: #000;
      display: none;
      overflow: hidden;
    }
    .${prefix}-progress {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 2px;
      background-color: rgba(255, 255, 255, 0.3);
      z-index: 10;
    }
    .${prefix}-progress-bar {
      height: 100%;
      background-color: #ff0000;
      width: 0;
    }
    .${prefix}-content {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    .${prefix}-image,
    .${prefix}-video {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .${prefix}-cta,
    .${prefix}-sound-prompt {
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.8);
      color: #fff;
      text-align: center;
      z-index: 10;
    }
    .${prefix}-cta p,
    .${prefix}-sound-prompt p {
      font-size: 1.5em;
      margin-bottom: 20px;
    }
    .${prefix}-cta button,
    .${prefix}-sound-prompt button,
    .${prefix}-skip,
    .${prefix}-replay {
      padding: 10px 20px;
      background-color: #fff;
      color: #000;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      margin: 10px;
      z-index: 15;
    }
    .${prefix}-skip {
      position: absolute;
      top: 10px;
      right: 10px;
    }
    .${prefix}-replay {
      position: absolute;
      top: 10px;
      left: 10px;
    }
  `;
  document.head.appendChild(style);

  // Create container and sub-elements
  const container = document.createElement('div');
  container.className = `${prefix}-container`;

  const progress = document.createElement('div');
  progress.className = `${prefix}-progress`;

  const progressBar = document.createElement('div');
  progressBar.className = `${prefix}-progress-bar`;
  progress.appendChild(progressBar);

  const content = document.createElement('div');
  content.className = `${prefix}-content`;

  container.appendChild(progress);
  container.appendChild(content);
  document.body.appendChild(container);

  // Get ad data
  const ads = window.adData || [];
  if (ads.length === 0) return; // No ads, do nothing

  // Function to start progress animation (central timer)
  function startProgress(duration, callback, media) {
    let startTime = null;
    progressBar.style.width = `${(adState.elapsedBeforePause / duration) * 100}%`;
    progressBar.style.transition = 'none';

    function updateProgress(timestamp) {
      if (adState.isPaused) return;

      if (!startTime) startTime = timestamp - adState.elapsedBeforePause * 1000;
      const elapsed = (timestamp - startTime) / 1000;
      const progress = Math.min(elapsed / duration, 1);
      progressBar.style.width = `${progress * 100}%`;

      if (media && media.tagName === 'VIDEO' && progress >= 1 && !adState.skipButton && !adState.videoEnded) {
        adState.skipButton = createSkipButton(() => showCTA(adState.currentIndex, media));
        content.appendChild(adState.skipButton);
      }

      if (progress < 1 || (media && media.tagName === 'VIDEO' && !adState.videoEnded)) {
        adState.animationFrameId = requestAnimationFrame(updateProgress);
      } else if (media && media.tagName === 'IMG') {
        adState.elapsedBeforePause = 0;
        callback();
      }
    }

    adState.animationFrameId = requestAnimationFrame(updateProgress);
  }

  // Function to pause ad
  function pauseAd() {
    if (adState.isPaused || !adState.currentMedia) return;
    adState.isPaused = true;
    adState.pauseStartTime = performance.now();
    if (adState.animationFrameId) {
      cancelAnimationFrame(adState.animationFrameId);
      adState.animationFrameId = null;
    }
    if (adState.currentMedia.tagName === 'VIDEO') {
      adState.currentMedia.pause();
      adState.elapsedBeforePause = Math.min(adState.currentMedia.currentTime, adState.currentDuration);
    }
  }

  // Function to resume ad
  function resumeAd() {
    if (!adState.isPaused || !adState.currentMedia) return;
    adState.isPaused = false;

    if (adState.currentMedia.tagName === 'IMG') {
      adState.elapsedBeforePause = 0;
      progressBar.style.width = '0%';
      startProgress(adState.currentDuration, adState.currentCallback, adState.currentMedia);
    } else if (adState.currentMedia.tagName === 'VIDEO') {
      const rewindSeconds = 2;
      adState.currentMedia.currentTime = Math.max(adState.currentMedia.currentTime - rewindSeconds, 0);
      adState.elapsedBeforePause = Math.max(adState.elapsedBeforePause - rewindSeconds, 0);
      progressBar.style.width = `${(adState.elapsedBeforePause / adState.currentDuration) * 100}%`;

      adState.currentMedia.play().catch(() => {
        adState.currentMedia.muted = true;
        adState.currentMedia.play();
      });
      if (adState.skipButton && !content.contains(adState.skipButton)) {
        content.appendChild(adState.skipButton);
      }
      startProgress(adState.currentDuration, adState.currentCallback, adState.currentMedia);
    }
  }

  // Handle focus/blur events
  window.onblur = () => {
    pauseAd();
  };

  window.onfocus = () => {
    resumeAd();
  };

  // Function to create skip button
  function createSkipButton(onClick) {
    const skipBtn = document.createElement('button');
    skipBtn.className = `${prefix}-skip`;
    skipBtn.textContent = 'Skip';
    skipBtn.onclick = () => {
      skipBtn.remove();
      adState.skipButton = null;
      onClick();
    };
    return skipBtn;
  }

  // Function to check if video audio is muted
  function isVideoMuted(video) {
    return video.muted || video.volume === 0;
  }

  // Function to show sound prompt (for videos)
  function showSoundPrompt(callback, media) {
    const promptDiv = document.createElement('div');
    promptDiv.className = `${prefix}-sound-prompt`;

    const msg = document.createElement('p');
    msg.textContent = 'Activate sound to play the video.';

    const activateBtn = document.createElement('button');
    activateBtn.textContent = 'Activate Sound';
    activateBtn.onclick = () => {
      promptDiv.remove();
      adState.soundActivated = true;
      callback(true, media);
    };

    promptDiv.appendChild(msg);
    promptDiv.appendChild(activateBtn);
    content.appendChild(promptDiv);
    promptDiv.style.display = 'flex';
  }

  // Function to start media playback and progress after load
  function startMediaAfterLoad(media, duration, callback) {
    if (media.tagName === 'IMG') {
      media.onload = () => {
        startProgress(duration, callback, media);
      };
      if (media.complete) {
        startProgress(duration, callback, media);
      }
    } else if (media.tagName === 'VIDEO') {
      if (media.readyState >= 4) {
        media.play();
        startProgress(duration, callback, media);
      } else {
        media.addEventListener('canplaythrough', () => {
          media.play();
          startProgress(duration, callback, media);
        }, {once: true});
      }
    }
  }

  // Function to show CTA
  function showCTA(index, media) {
    if (media && media.tagName === 'VIDEO') media.pause();
    content.innerHTML = '';
    adState.currentMedia = null;
    adState.skipButton = null;

    const ad = ads[index];
    const ctaDiv = document.createElement('div');
    ctaDiv.className = `${prefix}-cta`;

    const msg = document.createElement('div'); // Use div for flexible HTML
    msg.innerHTML = ad.cta.message; // Support inline CSS and <p>, <br>

    const actionBtn = document.createElement('button');
    actionBtn.className = `${prefix}-cta-button`;
    actionBtn.textContent = ad.cta.buttonText || 'Go'; // Default to 'Go' if not specified
    actionBtn.onclick = () => {
      window.open(ad.cta.link, '_blank');
    };

    const replayBtn = document.createElement('button');
    replayBtn.className = `${prefix}-replay`;
    replayBtn.textContent = 'See Again';
    replayBtn.onclick = () => {
      content.innerHTML = '';
      playAd(index, true);
    };

    const skipBtn = createSkipButton(() => playAd(index + 1));
    adState.skipButton = skipBtn;

    ctaDiv.appendChild(msg);
    if (ad.cta.link !== '#') {
      ctaDiv.appendChild(actionBtn); // Only show button if link is not '#'
    }
    ctaDiv.appendChild(replayBtn);
    ctaDiv.appendChild(skipBtn);
    content.appendChild(ctaDiv);
    ctaDiv.style.display = 'flex';
  }

  // Function to play ad item
  function playAd(index, isReplay = false) {
    if (index >= ads.length) {
      closeAd();
      return;
    }

    const ad = ads[index];
    content.innerHTML = '';
    progressBar.style.width = '0';
    adState.elapsedBeforePause = 0;
    adState.isPaused = false;
    adState.currentIndex = index;
    adState.isReplay = isReplay;
    adState.videoEnded = false;
    adState.skipButton = null;

    let media;

    if (ad.type === 'image') {
      media = document.createElement('img');
      media.src = ad.url;
      media.className = `${prefix}-image`;
      content.appendChild(media);
      adState.currentMedia = media;
      adState.currentDuration = ad.duration;
      adState.currentCallback = () => showCTA(index, media);
      if (isReplay) {
        adState.skipButton = createSkipButton(() => showCTA(index, media));
        content.appendChild(adState.skipButton);
      }
      startMediaAfterLoad(media, ad.duration, adState.currentCallback);
    } else if (ad.type === 'video') {
      media = document.createElement('video');
      media.src = ad.url;
      media.className = `${prefix}-video`;
      media.autoplay = false;
      media.muted = !adState.soundActivated;

      content.appendChild(media);
      adState.currentMedia = media;
      adState.currentDuration = ad.duration;
      adState.currentCallback = () => showCTA(index, media);

      media.onended = () => {
        adState.videoEnded = true;
        showCTA(index, media);
      };

      if (!adState.soundActivated && isVideoMuted(media) && !isReplay) {
        showSoundPrompt((soundActivatedResult, promptMedia) => {
          promptMedia.muted = !soundActivatedResult;
          promptMedia.currentTime = 0;
          startMediaAfterLoad(promptMedia, ad.duration, adState.currentCallback);
        }, media);
      } else {
        media.muted = false;
        if (isReplay) {
          adState.skipButton = createSkipButton(() => showCTA(index, media));
          content.appendChild(adState.skipButton);
        }
        startMediaAfterLoad(media, ad.duration, adState.currentCallback);
      }
    }
  }

  // Function to close the ad
  function closeAd() {
    container.style.display = 'none';
    adState.currentMedia = null;
    adState.skipButton = null;
    if (adState.animationFrameId) {
      cancelAnimationFrame(adState.animationFrameId);
      adState.animationFrameId = null;
    }
  }

  // Start the ad
  container.style.display = 'block';
  playAd(0);
})();