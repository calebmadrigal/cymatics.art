module.exports = {
  content: ["./src/*.html"],
  theme: { extend: {} },
  plugins: [
    require('@tailwindcss/forms')
  ],
  safelist: [
    'md:flex'
  ]
};

