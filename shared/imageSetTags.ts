export type SetTags = {setStyle?:string|null;setCategory?:string|null;setPrimaryColor?:string|null;setAccentColor?:string|null};
export function hasCompleteSetTags(set?: SetTags) {
  return Boolean(set?.setStyle && set.setCategory && set.setPrimaryColor && set.setAccentColor != null);
}
/** One source of truth: images never override their ASIN set's four shared labels. */
export function inheritSetImageTags<T>(image:T,set:SetTags) {
  return {...image,tagCategory:set.setCategory ?? null,tagDesignStyleV2:set.setStyle ?? null,
    tagDesignStyle:set.setStyle ?? null,tagColorSchemeV2:set.setPrimaryColor ?? null,
    tagColorScheme:set.setPrimaryColor ?? null,tagAccentColor:set.setAccentColor ?? null};
}
