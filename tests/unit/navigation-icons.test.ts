import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NavIcon,NAVIGATION_PATHS} from '../../src/renderer/lib/navigation-icon-registry';
it('all nine semantic icons have distinct outline/solid vectors in an invariant accessible slot',()=>{
 expect(Object.keys(NAVIGATION_PATHS)).toHaveLength(9);
 for(const name of Object.keys(NAVIGATION_PATHS) as (keyof typeof NAVIGATION_PATHS)[]){
  const outline=renderToStaticMarkup(createElement(NavIcon,{name,variant:'outline'})),solid=renderToStaticMarkup(createElement(NavIcon,{name,variant:'solid'}));
  expect(outline).not.toBe(solid);for(const svg of [outline,solid]){expect(svg).toContain('viewBox="0 0 24 24"');expect(svg).toContain('width="23.28"');expect(svg).toContain('aria-hidden="true"');expect(svg).not.toMatch(/<image|href=|<script/);}
 }
});
