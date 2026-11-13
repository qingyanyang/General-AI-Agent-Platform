import { Auth0Provider } from '@auth0/auth0-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from '@/App'
import { readAuthConfig } from '@/lib/auth-config'
import '@/index.css'

const auth = readAuthConfig()
const root = createRoot(document.getElementById('root')!)

root.render(
  <StrictMode>
    {auth ? (
      <Auth0Provider
        domain={auth.domain}
        clientId={auth.clientId}
        authorizationParams={{
          audience: auth.audience,
          redirect_uri: window.location.origin,
        }}
        cacheLocation="localstorage"
      >
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Auth0Provider>
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </StrictMode>,
)
