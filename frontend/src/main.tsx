import { onCleanup } from 'solid-js'
import { render } from 'solid-js/web'
import { createController } from './controller/createController'
import App from './view/App'
import './view/styles.css'

if (location.hash.startsWith('#/')) {
  const path = location.hash.slice(1).replace(/^\/b\/([^/]+)\/t\/(\d+)/, '/$1/$2').replace(/^\/b\//, '/')
  history.replaceState(null, '', path)
}

render(() => {
  const runtime = createController()
  onCleanup(runtime.commands.dispose)
  return <App runtime={runtime} />
}, document.getElementById('root')!)
