import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue' // (ya jo bhi framework aap use kar rahe ho)

export default defineConfig({
  base: './', // <--- Yeh line zaroori add karein
  plugins: [vue()],
}
