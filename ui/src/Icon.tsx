// Codicon wrapper. The codicon font is loaded once in styles.css;
// this just standardizes the markup.

import type { CSSProperties } from 'react';

export function Icon({
  name,
  className,
  title,
  style,
}: {
  name: string;
  className?: string;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <i
      className={`codicon codicon-${name}${className ? ' ' + className : ''}`}
      title={title}
      aria-hidden={!title}
      style={style}
    />
  );
}
