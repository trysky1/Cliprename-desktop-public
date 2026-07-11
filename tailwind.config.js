/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ClipRename Design System — dark olive base, bright green accent
        bg: '#0D0E0B',
        surface: '#151614',
        surface2: '#1C1D1A',
        raised: '#232420',
        border: '#252620',
        borderSoft: '#1C1D1A',
        text: '#EEEEE8',
        muted: '#888882',
        faint: '#55554E',
        // Primary accent (kept under the `mint` name so existing usages re-skin)
        mint: {
          DEFAULT: '#6EE87A',
          soft: '#8FF29A',
          deep: '#3DAF4A',
          muted: '#1E3D24',
          ink: '#0D0E0B'
        },
        green: {
          DEFAULT: '#6EE87A',
          dim: '#3DAF4A',
          muted: '#1E3D24'
        },
        // Semantic
        danger: '#E05252',
        warning: '#E8A24A',
        sky: '#8fb8f0',
        peach: '#f7c08a'
      },
      borderRadius: {
        sm: '3px',
        DEFAULT: '5px',
        md: '6px',
        lg: '10px',
        xl: '10px',
        '2xl': '12px',
        '3xl': '14px'
      },
      fontFamily: {
        sans: ['DM Sans', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Bricolage Grotesque', 'DM Sans', 'system-ui', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
        mono: ['Space Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px rgba(0,0,0,0.35)',
        soft: '0 4px 20px rgba(0,0,0,0.3)',
        glow: '0 0 0 3px rgba(110,232,122,0.15)'
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' }
        },
        floaty: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' }
        }
      },
      animation: {
        shimmer: 'shimmer 1.4s infinite',
        floaty: 'floaty 3s ease-in-out infinite'
      }
    }
  },
  plugins: []
}
