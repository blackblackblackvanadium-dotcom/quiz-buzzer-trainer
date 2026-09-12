import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Quiz Buzzer Trainer',
        short_name: 'QBT',
        description: 'Japanese competitive quiz buzzer training app',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#111111',
        icons: []
      }
    })
  ],
  test: {
    environment: 'node'
  }
})
