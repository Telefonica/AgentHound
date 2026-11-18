/**
 * Width of the wizard's container and of its footer: full width, and from
 * 1920px up it stops growing at 1440px. Both read it from here so they cannot
 * drift apart. It goes on a plain wrapper: Mistica's own (unlayered) styles win
 * over a utility class set on a Mistica component itself.
 */
export const WIZARD_WIDTH_CLASS = "w-full min-[1920px]:max-w-[1440px]";
