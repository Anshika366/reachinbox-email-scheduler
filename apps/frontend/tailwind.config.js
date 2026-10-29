export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#00A86B",
          hover: "#008f5a",
          light: "#E8F8F0"
        },
        sidebar: "#FBFBFC",
        borderline: "#EAEAEA"
      }
    }
  },
  plugins: []
};
