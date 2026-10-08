/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        status: {
          info: { DEFAULT: '#6366f1', light: '#e0e7ff' },    // Indigo
          warning: { DEFAULT: '#f59e0b', light: '#fef3c7' }, // Amber
          critical: { DEFAULT: '#ef4444', light: '#fee2e2' }, // Rose
        },
        brand: {
          primary: '#4f46e5', // Indigo-600
        }
      },
    },
  },
  plugins: [],
}
