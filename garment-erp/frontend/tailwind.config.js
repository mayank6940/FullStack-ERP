/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      minHeight: {
        '56px': '56px'
      },
      fontSize: {
        'base': '16px'
      }
    },
  },
  plugins: [],
}
