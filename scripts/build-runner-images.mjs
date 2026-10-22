#!/usr/bin/env node
/**
 * Build the sandbox images.
 *
 * `python-crypto` covers the large majority of challenges and is built by
 * default. `sage` is opt-in with `--sage` because it is a multi-gigabyte pull.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const IMAGES = [
  {
    tag: 'ayas-playground/runner-python-crypto:1',
    context: join(root, 'deploy', 'runner', 'python-crypto'),
    always: true,
  },
  {
    tag: 'ayas-playground/runner-sage:1',
    context: join(root, 'deploy', 'runner', 'sage'),
    always: false,
  },
]

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    )
  })
}

const wantSage = process.argv.includes('--sage')

for (const image of IMAGES) {
  if (!image.always && !wantSage) {
    console.log(`- skipping ${image.tag} (pass --sage to build it)`)
    continue
  }
  console.log(`\n> building ${image.tag}`)
  await run('docker', ['build', '-t', image.tag, image.context])
}

console.log('\nDone. Set AYA_RUNNER=docker to verify challenges for real.')
