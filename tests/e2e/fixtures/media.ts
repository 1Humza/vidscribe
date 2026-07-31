import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';

export const runtimeRoot = '/private/tmp/vidscribe-e2e';
export const sourcePath = `${runtimeRoot}/source.wav`;
export const destinationPath = `${runtimeRoot}/destination`;
export const dataPath = `${runtimeRoot}/data`;

export type FileIdentity = {
  digest: string;
  modifiedAt: number;
  size: number;
};

export function createLongPauseAudio(): FileIdentity {
  rmSync(runtimeRoot, { recursive: true, force: true });
  mkdirSync(destinationPath, { recursive: true });
  mkdirSync(dataPath, { recursive: true });

  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=1',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=mono:sample_rate=48000:duration=16',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:sample_rate=48000:duration=1',
      '-filter_complex',
      '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]',
      '-map',
      '[out]',
      '-c:a',
      'pcm_s16le',
      '-y',
      sourcePath,
    ],
    { stdio: 'inherit' },
  );

  return identifyFile(sourcePath);
}

export function identifyFile(path: string): FileIdentity {
  const stat = statSync(path);
  return {
    digest: createHash('sha256').update(readFileSync(path)).digest('hex'),
    modifiedAt: stat.mtimeMs,
    size: stat.size,
  };
}

export function inspectAnalysisAudio(path: string): {
  codec: string;
  channels: number;
  container: string;
  bitrate: number;
} {
  const output = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_name,channels:format=format_name,bit_rate',
      '-of',
      'json',
      path,
    ],
    { encoding: 'utf8' },
  );
  const probe = JSON.parse(output) as {
    streams: Array<{ codec_name: string; channels: number }>;
    format: { format_name: string; bit_rate: string };
  };

  return {
    codec: probe.streams[0].codec_name,
    channels: probe.streams[0].channels,
    container: probe.format.format_name,
    bitrate: Number(probe.format.bit_rate),
  };
}
