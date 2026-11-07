// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const query=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/trpc',()=>({trpc:{analysis:{reviewEvidence:{useQuery:query},aggregationReviewEvidence:{useQuery:query}}}}));
import ReviewEvidenceDialog,{AggregationReviewEvidenceDialog} from './ReviewEvidenceDialog';
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('shows the original review with its translation and star rating',()=>{
 query.mockReturnValue({isLoading:false,error:null,data:{total:1,available:1,pageSize:10,items:[{id:'a',title:'Great',body:'Strong and airy',rating:5,date:null,translation:'结实又透气'}]}});
 render(<ReviewEvidenceDialog projectId={1} analysisId={2} groupIndex={0} generatedAt="now" name="透气" onClose={()=>{}}/>);
 expect(screen.getByText('Strong and airy')).toBeInTheDocument();expect(screen.getByText('结实又透气')).toBeInTheDocument();expect(screen.getByText(/中文为 AI 翻译/)).toBeInTheDocument();
});
it('does not invent missing evidence and flags stale aggregate sources',()=>{
 query.mockReturnValue({isLoading:false,error:null,data:{total:0,available:0,pageSize:10,stale:true,items:[]}});
 render(<AggregationReviewEvidenceDialog projectId={1} itemId="id" name="质量" onClose={()=>{}}/>);
 expect(screen.getByText(/部分竞品分析已更新/)).toBeInTheDocument();
});
