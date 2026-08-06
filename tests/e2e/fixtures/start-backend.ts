import { spawn } from 'node:child_process';
import { createLongPauseAudio } from './media';

createLongPauseAudio();

const backend = spawn(process.env.VIDSCRIBE_TEST_PYTHON || '.venv/bin/python', ['-m', 'vidscribe'], {
  env: process.env,
  stdio: 'inherit',
});

function stop(signal: NodeJS.Signals): void {
  backend.kill(signal);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
backend.on('exit', (code) => process.exit(code ?? 1));
