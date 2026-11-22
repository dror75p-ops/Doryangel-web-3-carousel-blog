DoryAngel broker render kit (copied from the project folder 2026-11-22).
Setup: unzip into an empty folder, then: npm install --no-audit --no-fund   (installs puppeteer 23.11.1 + its Chrome, three 0.169.0)
Slides 1080x1350: node shot.js 'broker2.html?s=N' out/slide-N.png 1080 1350   (N=1..5)
Reel 1080x1920: REEL=reel2.html node framesb.js 24 out/frames   then
  ffmpeg -y -framerate 24 -i out/frames/f_%04d.jpg -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart out/reel.mp4
Preview one frame: REEL=reel2.html node framesb.js keys out/k 3 10
For a new week: copy broker2.html / reel2.html to new names, change copy and scenes; keep stack2.js, fonts and logo-white.png.
