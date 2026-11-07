INSERT INTO emperor_skills (slug,name,description,category,status,scope,version,isSystem,manifest,when_to_use)
SELECT 'design.scene.plan','场景图策划','根据产品主体、构图参考和效果参考策划场景图','美工','Released','global',1,1,
  JSON_OBJECT('implementation',JSON_OBJECT('systemPrompt','将产品主体的多张照片视为同一件商品，保持结构、形状、颜色、材质、文字和细节，不虚构不清楚的部分；构图参考只决定画面内容与产品位置，可为线稿、手绘或文字；效果参考只决定环境、色调、光线与质感。让产品符合透视并自然融入场景。输出具体可执行的画面提示词，禁止将效果图中的产品替换原产品。', 'userPromptTemplate','{{context}}')),
  '场景图生成时，结合三组参考图策划可执行提示词'
WHERE NOT EXISTS (SELECT 1 FROM emperor_skills WHERE slug='design.scene.plan');
