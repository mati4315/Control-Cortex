const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const run = promisify(execFile);
function binary(name) {
  const configured = process.env[name.toUpperCase() + '_BIN'];
  if (configured) return configured;
  const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', name + '.exe');
  return process.platform === 'win32' && fs.existsSync(winget) ? winget : name;
}
async function reverseAnimation(source, destination) {
  const options = { windowsHide: true, timeout: 600000, maxBuffer: 2 * 1024 * 1024 };
  const probe = await run(binary('ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'json', source], options);
  const codec = JSON.parse(probe.stdout).streams?.[0]?.codec_name;
  if (!['vp8', 'vp9'].includes(codec)) throw new Error('El inicio debe ser un WebM VP8 o VP9.');
  // Los decodificadores libvpx conservan también el canal alfa del WebM.
  await run(binary('ffmpeg'), ['-y', '-v', 'error', '-c:v', codec === 'vp9' ? 'libvpx-vp9' : 'libvpx', '-i', source,
    '-map', '0:v:0', '-an', '-vf', 'reverse', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
    '-b:v', '0', '-crf', '28', '-cpu-used', '4', '-threads', '2', '-f', 'webm', destination], options);
}
module.exports = { reverseAnimation };
