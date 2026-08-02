import { defineConfig } from 'vite'

// Firebase Hosting はルート '/' で配信、GitHub Pages はリポジトリ名の
// サブパス配信になるため、GH_PAGES 環境変数で切り替える。
export default defineConfig({
    base: process.env.GH_PAGES ? '/050_citychase/' : '/',
})
