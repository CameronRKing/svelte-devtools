import { writable, get, derived } from 'svelte/store'
import { addNodeListener, getSvelteVersion } from 'svelte-listener'

export const visibility = writable({
  component: true,
  element: true,
  block: true,
  iteration: true,
  slot: true,
  text: true,
  anchor: false
})
export const selectedNode = writable({})
export const hoveredNodeId = writable(null)
export const rootNodes = writable([])
export const searchValue = writable('')
export const profilerEnabled = writable(false)
export const profileFrame = writable({})

const nodeMap = new Map()

// const port = chrome.runtime.connect()
// port.postMessage({
//   type: 'init',
//   tabId: chrome.devtools.inspectedWindow.tabId
// })

export function reload() {
  // port.postMessage({
  //   type: 'reload',
  //   tabId: chrome.devtools.inspectedWindow.tabId
  // })
}

export function startPicker() {
  // port.postMessage({
  //   type: 'startPicker',
  //   tabId: chrome.devtools.inspectedWindow.tabId
  // })
}

export function stopPicker() {
  // port.postMessage({
  //   type: 'stopPicker',
  //   tabId: chrome.devtools.inspectedWindow.tabId
  // })
}

selectedNode.subscribe(node => {
  // port.postMessage({
  //   type: 'setSelected',
  //   tabId: chrome.devtools.inspectedWindow.tabId,
  //   nodeId: node.id
  // })

  let invalid = null
  while (node.parent) {
    node = node.parent
    if (node.collapsed) {
      invalid = node
      node.collapsed = false
    }
  }

  if (invalid) invalid.invalidate()
})

hoveredNodeId.subscribe(nodeId => {}
  // port.postMessage({
  //   type: 'setHover',
  //   tabId: chrome.devtools.inspectedWindow.tabId,
  //   nodeId
  // })
)

profilerEnabled.subscribe(o => {}
  // port.postMessage({
  //   type: o ? 'startProfiler' : 'stopProfiler',
  //   tabId: chrome.devtools.inspectedWindow.tabId
  // })
)

function noop() {}

function insertNode(node, target, anchorId) {
  node.parent = target

  let index = -1
  if (anchorId) index = target.children.findIndex(o => o.id == anchorId)

  if (index != -1) {
    target.children.splice(index, 0, node)
  } else {
    target.children.push(node)
  }

  target.invalidate()
}

function resolveFrame(frame) {
  frame.children.forEach(resolveFrame)

  if (!frame.node) return

  frame.node = nodeMap.get(frame.node) || {
    tagName: 'Unknown',
    type: 'Unknown'
  }
}

function resolveEventBubble(node) {
  if (!node.detail || !node.detail.listeners) return

  for (const listener of node.detail.listeners) {
    if (!listener.handler.includes('bubble($$self, event)')) continue

    listener.handler = () => {
      let target = node
      while ((target = target.parent)) if (target.type == 'component') break

      const listeners = target.detail.listeners
      if (!listeners) return null

      const parentListener = listeners.find(o => o.event == listener.event)
      if (!parentListener) return null

      const handler = parentListener.handler
      if (!handler) return null

      return (
        '// From parent\n' +
        (typeof handler == 'function' ? handler() : handler)
      )
    }
  }
}

// originally, this function existed to pass node data from the content script to the extension
// but as it did so, it also reshaped the internal data
// the extension relies on that reshaping, so we must continue to "serialize" the node,
// even though we could pass the whole object anyway
function serializeNode(node) {
  const serialized = {
    id: node.id,
    type: node.type,
    tagName: node.tagName
  }
  switch (node.type) {
    case 'component': {
      if (!node.detail.$$) {
        serialized.detail = {}
        break
      }

      const internal = node.detail.$$
      const props = Array.isArray(internal.props)
        ? internal.props // Svelte < 3.13.0 stored props names as an array
        : Object.keys(internal.props)
      let ctx = //clone(
        shouldUseCapture() ? node.detail.$capture_state() : internal.ctx
      //)
      if (ctx === undefined) ctx = {}

      serialized.detail = {
        attributes: props.flatMap(key => {
          const value = ctx[key]
          delete ctx[key]
          return value === undefined
            ? []
            : { key, value, isBound: key in internal.bound }
        }),
        listeners: Object.entries(internal.callbacks).flatMap(
          ([event, value]) => value.map(o => ({ event, handler: o.toString() }))
        ),
        ctx: Object.entries(ctx).map(([key, value]) => ({ key, value }))
      }
      break
    }

    case 'element': {
      const element = node.detail
      serialized.detail = {
        attributes: Array.from(element.attributes).map(attr => ({
          key: attr.name,
          value: attr.value
        })),
        listeners: element.__listeners
          ? element.__listeners.map(o => ({
              ...o,
              handler: o.handler.toString()
            }))
          : []
      }

      break
    }

    case 'text': {
      serialized.detail = {
        nodeValue: node.detail.nodeValue
      }
      break
    }

    case 'iteration':
    case 'block': {
      const { ctx, source } = node.detail
      serialized.detail = {
        ctx: Object.entries(/*clone(*/ctx/*)*/).map(([key, value]) => ({
          key,
          value
        })),
        source: source.substring(source.indexOf('{'), source.indexOf('}') + 1)
      }
    }
  }

  return serialized
}

// for some reason, clone() was being called hundreds of thousands of times,
// it was piling data on the stack, and freezing the application
// so I just removed calls to it. Didn't seem like they were really doing anything, anyway.
function clone(value, seen = new Map()) {
  switch (typeof value) {
    case 'function':
      return { __isFunction: true, source: value.toString(), name: value.name }
    case 'symbol':
      return { __isSymbol: true, name: value.toString() }
    case 'object':
      if (value === window || value === null) return null
      if (Array.isArray(value)) return value.map(o => clone(o, seen))
      if (seen.has(value)) return {}

      const o = {}
      seen.set(value, o)

      for (const [key, v] of Object.entries(value)) {
        o[key] = clone(v, seen)
      }

      return o
    default:
      return value
  }
}

function gte(major, minor, patch) {
  const version = (getSvelteVersion() || '0.0.0')
    .split('.')
    .map(n => parseInt(n))
  return (
    version[0] > major ||
    (version[0] == major &&
      (version[1] > minor || (version[1] == minor && version[2] >= patch)))
  )
}

let _shouldUseCapture = null
function shouldUseCapture() {
  return _shouldUseCapture == null
    ? (_shouldUseCapture = gte(3, 19, 2))
    : _shouldUseCapture
}

addNodeListener({
  add(node, anchor) {
    // console.log('add', node, anchor);
    const target = node.parent ? node.parent.id : null;
    anchor = anchor ? anchor.id : null;
    node = serializeNode(node);
    node.children = []
    node.collapsed = true
    node.invalidate = noop
    resolveEventBubble(node)

    const targetNode = nodeMap.get(target)
    nodeMap.set(node.id, node)

    if (targetNode) {
      insertNode(node, targetNode, anchor)
      return
    }

    if (node._timeout) return

    node._timeout = setTimeout(() => {
      delete node._timeout
      const targetNode = nodeMap.get(target)
      if (targetNode) insertNode(node, targetNode, anchor)
      else rootNodes.update(o => (o.push(node), o))
    }, 100)
  },
  remove(node) {
    node = serializeNode(node);
    const toRemove = nodeMap.get(node.id);
    // console.log('remove', node, node.parent, toRemove, toRemove.parent);
    nodeMap.delete(toRemove.id)

    if (toRemove.parent) {
      const index = toRemove.parent.children.findIndex(o => o.id == toRemove.id)
      toRemove.parent.children.splice(index, 1)
      toRemove.parent.invalidate()
    }
  },
  update(node) {
    // console.log('update', node);
    node = serializeNode(node);
    const toUpdate = nodeMap.get(node.id)
    Object.assign(toUpdate, node)
    resolveEventBubble(toUpdate)

    const selected = get(selectedNode)
    if (selected && selected.id == node.id) selectedNode.update(o => o)

    toUpdate.invalidate()
  },
})
// port.onMessage.addListener(msg => {
//   switch (msg.type) {
//     case 'clear': {
//       selectedNode.set({})
//       hoveredNodeId.set(null)
//       rootNodes.set([])

//       break
//     }

//     case 'addNode': {
//       const node = msg.node
//       node.children = []
//       node.collapsed = true
//       node.invalidate = noop
//       resolveEventBubble(node)

//       const targetNode = nodeMap.get(msg.target)
//       nodeMap.set(node.id, node)

//       if (targetNode) {
//         insertNode(node, targetNode, msg.anchor)
//         return
//       }

//       if (node._timeout) return

//       node._timeout = setTimeout(() => {
//         delete node._timeout
//         const targetNode = nodeMap.get(msg.target)
//         if (targetNode) insertNode(node, targetNode, msg.anchor)
//         else rootNodes.update(o => (o.push(node), o))
//       }, 100)

//       break
//     }

//     case 'removeNode': {
//       const node = nodeMap.get(msg.node.id)
//       const index = node.parent.children.findIndex(o => o.id == node.id)
//       node.parent.children.splice(index, 1)
//       nodeMap.delete(node.id)

//       node.parent.invalidate()

//       break
//     }

//     case 'updateNode': {
//       const node = nodeMap.get(msg.node.id)
//       Object.assign(node, msg.node)
//       resolveEventBubble(node)

//       const selected = get(selectedNode)
//       if (selected && selected.id == msg.node.id) selectedNode.update(o => o)

//       node.invalidate()

//       break
//     }

//     case 'inspect': {
//       let node = nodeMap.get(msg.node.id)
//       selectedNode.set(node)

//       break
//     }

//     case 'updateProfile': {
//       resolveFrame(msg.frame)
//       profileFrame.set(msg.frame)
//       break
//     }
//   }
// })
