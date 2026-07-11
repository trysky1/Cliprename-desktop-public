import React from 'react'

// Single icon family (Lucide-style geometry): 24px viewBox, stroke=currentColor,
// consistent 1.75 stroke width, round caps. Sized via the `size` prop so icons
// inherit text color and scale with their context.
interface IconProps {
  size?: number
  className?: string
}

function base(
  props: IconProps,
  children: React.ReactNode
): React.ReactElement {
  const { size = 16, className } = props
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function IconSparkles(props: IconProps): React.ReactElement {
  return base(
    props,
    <>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
    </>
  )
}

export function IconScissors(props: IconProps): React.ReactElement {
  return base(
    props,
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.1 8.1L20 20" />
      <path d="M14.5 9.5L20 4" />
      <path d="M8.1 15.9l3.4-3.4" />
    </>
  )
}

export function IconBot(props: IconProps): React.ReactElement {
  return base(
    props,
    <>
      <rect x="5" y="8" width="14" height="11" rx="2.5" />
      <path d="M12 8V5" />
      <circle cx="12" cy="3.5" r="1.2" />
      <path d="M9.5 13.5h.01M14.5 13.5h.01" strokeWidth="2.4" />
      <path d="M2.5 13.5h2.5M19 13.5h2.5" />
    </>
  )
}

export function IconFolder(props: IconProps): React.ReactElement {
  return base(
    props,
    <path d="M3.5 6.5a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.5.66l1 1.18a2 2 0 0 0 1.5.66h5.4a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11z" />
  )
}

export function IconCopy(props: IconProps): React.ReactElement {
  return base(
    props,
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </>
  )
}

export function IconFolderInput(props: IconProps): React.ReactElement {
  return base(
    props,
    <>
      <path d="M3.5 8V6.5a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.5.66l1 1.18a2 2 0 0 0 1.5.66h5.4a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V16" />
      <path d="M2 12h8" />
      <path d="M7 9l3 3-3 3" />
    </>
  )
}

export function IconPen(props: IconProps): React.ReactElement {
  return base(
    props,
    <>
      <path d="M12.8 5.2l6 6L8 22H2v-6L12.8 5.2z" />
      <path d="M15.5 2.5a2.1 2.1 0 0 1 3 0l3 3a2.1 2.1 0 0 1 0 3l-1.7 1.7-6-6 1.7-1.7z" />
    </>
  )
}

export function IconClapper(props: IconProps): React.ReactElement {
  return base(
    props,
    <>
      <rect x="3" y="9.5" width="18" height="10.5" rx="2" />
      <path d="M3.6 9.5L20 5l-.8-2.7L3 6.8l.6 2.7z" />
      <path d="M8 8.2L10.5 4M13 6.9L15.5 2.7" />
    </>
  )
}

export function IconUser(props: IconProps): React.ReactElement {
  return base(
    props,
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  )
}

export function IconCheck(props: IconProps): React.ReactElement {
  return base(props, <path d="M4 12.5l5 5L20 6.5" />)
}
