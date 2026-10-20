/** Lucide 本地图标注册表：白名单 slug → 组件；缺失时回退到通用占位并保留分类名。 */

import type { JSX } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Armchair,
  Baby,
  Banknote,
  Bike,
  BookBookmark,
  BriefcaseBusiness,
  BriefcaseMedical,
  Brush,
  BusFront,
  Cable,
  Car,
  Carrot,
  ChartLine,
  Cherry,
  ClipboardCheck,
  Cupcake,
  Database,
  Dog,
  Ellipsis,
  Gift,
  GraduationCap,
  Hammer,
  HeartHandshake,
  House,
  ImagePlus,
  LayoutGrid,
  ListChecks,
  MessagesSquare,
  Mic,
  NotebookPen,
  Package,
  PersonStanding,
  PhoneCall,
  Plane,
  Settings,
  Shirt,
  ShoppingBag,
  Ticket,
  Toilet,
  UsersRound,
  Utensils,
  Wine,
} from 'lucide-react';
import { iconSlug } from '../../shared/icons';

/** 与 src/shared/icons.ts 的 ICON_SLUGS 一一对应；单测会校验键集合完全相等。 */
export const ICON_COMPONENTS: Readonly<Record<string, LucideIcon>> = {
  utensils: Utensils,
  'shopping-bag': ShoppingBag,
  toilet: Toilet,
  'bus-front': BusFront,
  carrot: Carrot,
  cherry: Cherry,
  cupcake: Cupcake,
  bike: Bike,
  mic: Mic,
  'phone-call': PhoneCall,
  shirt: Shirt,
  brush: Brush,
  house: House,
  armchair: Armchair,
  baby: Baby,
  'person-standing': PersonStanding,
  'messages-square': MessagesSquare,
  plane: Plane,
  wine: Wine,
  cable: Cable,
  car: Car,
  'briefcase-medical': BriefcaseMedical,
  'book-bookmark': BookBookmark,
  'graduation-cap': GraduationCap,
  dog: Dog,
  banknote: Banknote,
  gift: Gift,
  'briefcase-business': BriefcaseBusiness,
  hammer: Hammer,
  'heart-handshake': HeartHandshake,
  ticket: Ticket,
  'users-round': UsersRound,
  package: Package,
  ellipsis: Ellipsis,
  settings: Settings,
  'notebook-pen': NotebookPen,
  'chart-line': ChartLine,
  'image-plus': ImagePlus,
  'list-checks': ListChecks,
  'clipboard-check': ClipboardCheck,
  'layout-grid': LayoutGrid,
  database: Database,
};

export interface AppIconProps {
  readonly iconKey: string;
  readonly size?: number;
  readonly className?: string;
}

export function AppIcon({ iconKey, size = 20, className }: AppIconProps): JSX.Element {
  const slug = iconSlug(iconKey);
  const Component = slug ? ICON_COMPONENTS[slug] : undefined;
  const Fallback = Component ?? Ellipsis;
  return (
    <Fallback
      size={size}
      strokeWidth={2}
      className={className}
      aria-hidden="true"
      focusable="false"
      data-icon-slug={slug ?? 'unknown'}
    />
  );
}
