import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    historyApiFallback: true,
    proxy: {
      '/api': {
        target: 'https://backend-six-flax-84.vercel.app',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5173,
    historyApiFallback: true,
    proxy: {
      '/api': {
        target: 'https://backend-six-flax-84.vercel.app',
        changeOrigin: true,
      },
    },
  },
})

 
