import { COMPETITOR_SCRIPT_ANALYSIS_PROMPT, COMPETITOR_SUMMARY_PROMPT, PRODUCT_INFO_EXTRACTION_PROMPT, SECTION_PLANNING_PROMPT,
  SUBTOPIC_EXPANSION_PROMPT, SHOT_DETAIL_PROMPT, EDIT_SCRIPT_PROMPT, getVideoTypeTemplate, buildStylePresetPrompt } from "../../videoScriptPrompts";
import { videoWorkflowCanonical, type VideoWorkflowOperation } from "../../../shared/videoWorkflow";

/** Original video business prompts are context, not a substitute Skill approval.
 * Every source array remains complete in the separately hashed tables. */
export function videoWorkflowBusinessPrompt(operation: VideoWorkflowOperation, tables: Record<string, Record<string, unknown>[]>, competitorId: number | null) {
  const script = tables.video_scripts[0], product = tables.video_product_snapshots, summary = tables.video_competitor_summary;
  const templates = { competitor_analysis: COMPETITOR_SCRIPT_ANALYSIS_PROMPT, competitor_summary: COMPETITOR_SUMMARY_PROMPT,
    product_info: PRODUCT_INFO_EXTRACTION_PROMPT, sections: SECTION_PLANNING_PROMPT, subtopics: SUBTOPIC_EXPANSION_PROMPT,
    shots: SHOT_DETAIL_PROMPT, edit_scripts: EDIT_SCRIPT_PROMPT };
  const values: Record<string, string> = {
    competitor_content: String(tables.video_competitor_scripts.find(row => row.id === competitorId)?.rawContent ?? ""),
    competitor_analyses: videoWorkflowCanonical(tables.video_competitor_scripts),
    product_data: videoWorkflowCanonical(Object.fromEntries(Object.entries(tables).filter(([name]) => !name.startsWith("video_")))),
    product_info: videoWorkflowCanonical(product), competitor_reference: videoWorkflowCanonical(summary),
    knowledge_base_examples: videoWorkflowCanonical(tables.kb_videos ?? []),
    sections: videoWorkflowCanonical(tables.video_script_sections),
    subtopics_structure: videoWorkflowCanonical(tables.video_script_sections.map(section => ({ ...section,
      subtopics: tables.video_script_subtopics.filter(row => row.sectionId === section.id) }))),
    sections_with_shots: videoWorkflowCanonical(tables.video_script_sections.map(section => ({ ...section,
      shots: tables.video_script_shots.filter(row => row.sectionId === section.id) }))),
    video_type: String(script.videoType ?? "main_video"), video_type_template: getVideoTypeTemplate(String(script.videoType ?? "main_video")),
    style_preset: buildStylePresetPrompt(String(script.stylePreset ?? "minimal_white")), target_duration: String(script.targetDuration ?? "未指定，由类型规范提出候选"),
    spv_segment_index: videoWorkflowCanonical(tables.video_spv_segments),
  };
  return templates[operation].replace(/\{([a-z_]+)\}/gu, (original, key: string) => values[key] ?? original);
}
