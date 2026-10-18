import type { VideoWorkflowOperation } from "../../../shared/videoWorkflow";
/** Synthetic contract examples, never approved prompts or production records. */
export const videoWorkflowCandidates: Record<VideoWorkflowOperation, Record<string, unknown>> = {
  competitor_analysis: { structure_analysis: { sections: [], narrative_mode: "SYNTHETIC", duration_feature: "No media processed", video_type_guess: "unknown" },
    visual_language: { shot_distribution: {}, camera_movement: "Unknown", color_tone: "Unknown", transition: "Unknown", style_preset_match: "other" },
    copywriting_analysis: { overlay_style: "Text", subtitle_style: "Text", narration_style: "Text", cta_text: "Text" }, strengths: ["Synthetic"], weaknesses: ["Synthetic"], reusable_patterns: [] },
  competitor_summary: { common_structure: { typical_sections: ["Synthetic"], typical_duration_range: "Unknown", common_narrative_mode: "Synthetic" },
    optimal_duration_allocation: [], differentiable_opportunities: [], recommended_structure: { sections: [], total_duration_suggestion: "Unknown", narrative_mode: "Synthetic" }, style_recommendation: {} },
  product_info: { basic_info: { product_name: "SYNTHETIC PRODUCT", brand: "Synthetic", category: "Synthetic", price_range: "Unknown", target_audience: "Synthetic" },
    selling_points_hierarchy: [], pain_points_from_reviews: [], key_specs: [], keywords_for_overlay: [], listing_bullet_mapping: [], brand_info: {} },
  sections: { sections: [{ section_code: "MBP1", scene_name: "Synthetic", section_name: "Synthetic section", section_name_en: "Synthetic section", shooting_method: "live_action",
    duration_budget: 4, selling_point_refs: ["Synthetic source"], pain_point_refs: [], description: "Full synthetic description", shot_type_suggestion: "medium", props_suggestion: [] }],
    total_duration: 4, narrative_mode: "Synthetic", duration_allocation_rationale: "Synthetic", style_guidance: "Synthetic" },
  subtopics: { sections: [{ section_code: "MBP1", subtopics: [{ subtopic_name: "Synthetic subtopic", subtopic_name_en: "Synthetic subtopic", duration_budget: 4, shot_count: 1, selling_point_ref: "Synthetic", description: "Synthetic" }] }],
    reuse_suggestions: [], shot_distribution: { medium: "100%" } },
  shots: { shots: [{ section_code: "MBP1", subtopic_name: "Synthetic subtopic", shot_code: "MBP1-01", duration: 4, shot_description: "Complete synthetic frame", scene_location: "Synthetic studio",
    camera_angle: "medium", camera_movement: "fixed", overlay_text_en: "TEXT", overlay_text_cn: "文字", narration_en: "Voice", narration_cn: "旁白", subtitle_en: "Sub", subtitle_cn: "字幕",
    narrator_type: "voiceover", generation_strategy: "real_shoot", reuse_from_shot_code: null, color_scheme: "white", props: [], notes: "Complete synthetic notes", reference_notes: "No media decoded" }] },
  edit_scripts: { edit_scripts: [{ edit_name: "Synthetic edit", video_purpose: "main_listing", max_duration: 4, edit_style: "sequential", section_mapping: [{ section_code: "MBP1", include: true, trim_strategy: "none" }], description: "Complete synthetic edit" }] },
};
