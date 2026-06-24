// Vitest setup file. Loaded before every test module.
//
// - Wires @testing-library/jest-dom matchers into expect (so
//   `expect(el).toHaveClass('selected')` etc. work).
// - Cleans up the DOM between tests via Testing Library's auto-cleanup
//   (it does this automatically when imported, but importing here
//   makes it explicit).

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
