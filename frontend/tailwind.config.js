/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        background: "#F2F3F5", // Very light gray from image
        surface: "#FFFFFF", // White card background
        primary: "#1F2937", // Dark gray text (Gray-800)
        secondary: "#6B7280", // Medium gray text (Gray-500)
        accent: "#F97316", // Orange-500 from image
        "accent-hover": "#EA580C", // Orange-600
      },
      borderRadius: {
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
};
