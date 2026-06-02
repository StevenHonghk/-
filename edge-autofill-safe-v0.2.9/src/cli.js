#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig } from './config.js';
import { runAutofill } from './autofill.js';
import { loadCurrentTabConfig, loadSequenceConfig } from './sequence-config.js';
import { runSequenceFill } from './sequence-fill.js';
import { runCurrentTabFill } from './current-tab.js';

function usage() {
  return [
    'Usage:',
    '  npm start -- --config configs/local.json',
    '  npm run fill-seq -- --config configs/sequence.json',
    '  npm run fill-current',
    '',
    'Safety defaults:',
    '  - opens Microsoft Edge with a separate profile directory',
    '  - only visits origins listed in allowedOrigins',
    '  - fills fields but never submits forms',
    '  - waits for manual review before closing Edge'
  ].join('\n');
}

function getOptionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) {
    return null;
  }

  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) {
    return { command: 'help' };
  }

  const command = ['fill-seq', 'fill-current'].includes(args[0]) ? args[0] : 'autofill';
  const commandArgs = command === 'autofill' ? args : args.slice(1);
  const configPath = getOptionValue(commandArgs, '--config') ?? commandArgs[0];

  if (command === 'fill-seq' || command === 'fill-current') {
    return {
      command,
      configPath: configPath ?? 'configs/sequence.json'
    };
  }

  return {
    command,
    configPath: configPath ?? 'configs/local.json'
  };
}

async function waitForManualReview() {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question('\nReview the filled fields in Edge. Press Enter here to close Edge.');
  } finally {
    rl.close();
  }
}

async function choosePage(candidates) {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question('\nChoose a tab number to fill: ');
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'help') {
    console.log(usage());
    return;
  }

  if (args.command === 'fill-seq') {
    const config = await loadSequenceConfig(args.configPath);
    await runSequenceFill(config, {
      log: console.log,
      reviewWaiter: waitForManualReview
    });
    return;
  }

  if (args.command === 'fill-current') {
    const config = await loadCurrentTabConfig(args.configPath);
    await runCurrentTabFill(config, {
      log: console.log,
      choosePage
    });
    return;
  }

  const config = await loadConfig(args.configPath);
  await runAutofill(config, {
    log: console.log,
    reviewWaiter: waitForManualReview
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
