import * as fs from 'fs'
import svelte from 'rollup-plugin-svelte'
import resolve from 'rollup-plugin-node-resolve'

export default [{
  input: 'src/index.js',
  external: ['chrome'],
  output: {
    file: 'public/build/bundle.js',
    name: 'App',
    format: 'iife',
    globals: {
      chrome: 'chrome'
    }
  },
  plugins: [
    svelte({
      dev: true,
      accessors: true,
      preprocess: {
        markup: input => {
          const code = input.content
            .replace(/(>|})\s+(?![^]*?<\/(?:script|style)>|[^<]*?>|[^{]*?})/g, '$1')
            .replace(/(?<!<[^>]*?|{[^}]*?)\s+(<|{)(?![^]*<\/(?:script|style)>)/g, '$1')
          return { code }
        }
      },
      css: css => css.write('public/build/styles.css'),
    }),
    resolve(),
    serve(),
  ]
}, {
  input: 'src/client/index.js',
  output: {
    file: 'dest/privilegedContent.js',
    name: 'SvelteDevtools',
    format: 'iife',
    banner: `if (!window.tag) {
  window.tag = document.createElement('script')
  window.tag.text = \``,
    footer: `\`
  if (window.profilerEnabled) window.tag.text = window.tag.text.replace('let profilerEnabled = false;', '\$&\\nstartProfiler();')
  document.children[0].append(window.tag)
  const port = chrome.runtime.connect()
  port.onMessage.addListener(window.postMessage.bind(window))
  window.addEventListener(
    'message',
    e => e.source == window && port.postMessage(e.data),
    false
  )
  window.addEventListener('unload', () => port.postMessage({ type: 'clear' }))
}`
  },
  plugins: [ resolve() ]
}, {
  input: 'test/src/index.js',
  output: {
    file: 'public/build/test.js',
    name: 'App',
    format: 'iife'
  },
  plugins: [
    svelte({
      dev: true,
      css: css => css.write('test/public/styles.css')
    }),
    resolve()
  ]
}]

function serve() {
    let started = false;

    return {
        writeBundle() {
            if (!started) {
                started = true;

                require('child_process').spawn('npm', ['run', 'start', '--', '--dev'], {
                    stdio: ['ignore', 'inherit', 'inherit'],
                    shell: true
                });
            }
        }
    };
}
