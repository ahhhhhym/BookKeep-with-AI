import type {NavigationIconKey} from '../../shared/navigation-icons';
/** Original navigation vectors. Solid silhouettes use explicit cut-outs, not filled strokes. */
import {NAVIGATION_PATHS} from '../../shared/navigation-icons';
export {NAVIGATION_PATHS} from '../../shared/navigation-icons';
export function NavIcon({name,variant,size=23.28,className=''}:{name:NavigationIconKey;variant:'outline'|'solid';size?:number;className?:string}){
 return <svg className={`app-icon navigation-icon ${className}`} data-navigation-icon={name} data-variant={variant} width={size} height={size} viewBox="0 0 24 24" fill={variant==='solid'?'currentColor':'none'} stroke={variant==='outline'?'currentColor':'none'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={NAVIGATION_PATHS[name][variant]} fillRule="evenodd"/></svg>;
}
