// Load the official video only after an explicit user action.
const launch = document.getElementById('sifa-video-launch');
if (launch) launch.addEventListener('click', (event) => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  const frame = document.createElement('iframe');
  frame.src = 'https://www.youtube-nocookie.com/embed/5Vdn_AVGRA4?autoplay=1';
  frame.title = 'Welcome to SIFA Global Institute — Official introduction video';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  frame.allowFullscreen = true;
  launch.replaceWith(frame);
  frame.focus();
});
