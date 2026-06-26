// Component test entry. Loaded by playwright/index.html before each
// CT mount. Pull in the same global styles that real hosts ship so
// every CT test sees the production look-and-feel.

import '../src/styles.css';
import '../src/tokens.css';
import '../src/themes/auto.css';
