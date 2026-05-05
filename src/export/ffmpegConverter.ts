import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Singleton instance
const ffmpeg = new FFmpeg();

export async function convertWebMToMp4(webmBlob: Blob, onProgress?: (progress: number) => void): Promise<Blob> {
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  
  if (!ffmpeg.loaded) {
    console.log('[FFmpeg] Loading core (Single-Threaded)...');
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    console.log('[FFmpeg] Loaded.');
  }

  ffmpeg.on('progress', ({ progress }) => {
    onProgress?.(progress);
  });

  console.log('[FFmpeg] Writing input file...');
  await ffmpeg.writeFile('input.webm', await fetchFile(webmBlob));
  
  console.log('[FFmpeg] Starting conversion...');
  // Use H.264 encoding for max compatibility
  // -c:v libx264 -preset fast -crf 22
  await ffmpeg.exec(['-i', 'input.webm', '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', 'output.mp4']);
  
  console.log('[FFmpeg] Reading output file...');
  const data = await ffmpeg.readFile('output.mp4');
  
  // Cast data to any to bypass type mismatch between ffmpeg FileData and BlobPart
  // ffmpeg.readFile returns Uint8Array which is a valid BlobPart, but type definitions might conflict
  return new Blob([data as any], { type: 'video/mp4' });
}

export async function createVideoFromFrames(
  frames: Blob[], 
  fps: number, 
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  
  if (!ffmpeg.loaded) {
    console.log('[FFmpeg] Loading core (Single-Threaded)...');
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
  }

  ffmpeg.on('progress', ({ progress }) => {
    onProgress?.(progress);
  });

  console.log(`[FFmpeg] Writing ${frames.length} frames...`);
  
  // Write frames to FS one by one and delete immediately to save memory
  for (let i = 0; i < frames.length; i++) {
    const filename = `frame_${i.toString().padStart(3, '0')}.png`;
    await ffmpeg.writeFile(filename, await fetchFile(frames[i]));
    frames[i] = null as any; // Release memory for the Blob immediately
    if (i % 50 === 0) { // Periodically yield to prevent UI freeze
      await new Promise(r => setTimeout(r, 0));
    }
  }

  console.log('[FFmpeg] Stitching frames...');
  // -r sets input framerate
  // -c:v libvpx-vp9 for WebM
  // -pix_fmt yuv420p for compatibility
  // -crf 30 for decent quality/size balance
  // -b:v 0 to allow CRF to control quality
  await ffmpeg.exec([
    '-framerate', fps.toString(),
    '-i', 'frame_%03d.png',
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuv420p',
    '-b:v', '2M', // Target bitrate 2M
    'output.webm'
  ]);

  console.log('[FFmpeg] Reading output video...');
  const data = await ffmpeg.readFile('output.webm');

  // Cleanup files
  for (let i = 0; i < frames.length; i++) {
    const filename = `frame_${i.toString().padStart(3, '0')}.png`;
    try { await ffmpeg.deleteFile(filename); } catch(_e) { /* ignore */ }
  }
  try { await ffmpeg.deleteFile('output.webm'); } catch(_e) { /* ignore */ }

  return new Blob([data as any], { type: 'video/webm' });
}