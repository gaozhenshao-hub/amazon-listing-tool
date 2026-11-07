import { expect, it, vi } from 'vitest';
const run=vi.hoisted(()=>vi.fn());
vi.mock('../ai_os/services/skillRunner',()=>({runEmperorSkill:run}));
import {runCompetitorSkill} from './runCompetitorSkill';
it('retries a transient failure using only the configured model',async()=>{
 vi.useFakeTimers();run.mockReset().mockRejectedValueOnce({cause:{code:'INVALID_OUTPUT',retryable:true}}).mockResolvedValueOnce({parsed:'ok'});
 const task=runCompetitorSkill({skillSlug:'test',userId:1,context:'test'});await vi.runAllTimersAsync();
 expect(await task).toEqual({parsed:'ok'});expect(run).toHaveBeenCalledTimes(2);expect(run).toHaveBeenCalledWith(expect.objectContaining({maxModelAttempts:1,fallbackModels:[]}));vi.useRealTimers();
});
it('does not retry a non-retryable failure',async()=>{
 run.mockReset().mockRejectedValue({cause:{code:'PROMPT_MISSING',retryable:false}});
 await expect(runCompetitorSkill({skillSlug:'test',userId:1,context:'test'})).rejects.toBeTruthy();expect(run).toHaveBeenCalledTimes(1);
});
it('retries a direct SkillRunError while keeping the same configured model',async()=>{
 vi.useFakeTimers();run.mockReset().mockRejectedValueOnce({code:'INVALID_OUTPUT',retryable:true,cause:new Error('schema mismatch')}).mockResolvedValueOnce({parsed:'valid'});
 const task=runCompetitorSkill({skillSlug:'test',userId:1,context:'test'});await vi.runAllTimersAsync();
 expect(await task).toEqual({parsed:'valid'});expect(run).toHaveBeenCalledTimes(2);expect(run).toHaveBeenCalledWith(expect.objectContaining({maxModelAttempts:1,fallbackModels:[]}));vi.useRealTimers();
});
it('limits repeated invalid output to three calls',async()=>{
 vi.useFakeTimers();const error={code:'INVALID_OUTPUT',retryable:true};run.mockReset().mockRejectedValue(error);
 const task=runCompetitorSkill({skillSlug:'test',userId:1,context:'test'});const rejection=expect(task).rejects.toBe(error);await vi.runAllTimersAsync();await rejection;
 expect(run).toHaveBeenCalledTimes(3);vi.useRealTimers();
});
it('can supply precise format correction before retry without changing the configured model',async()=>{
 vi.useFakeTimers();run.mockReset().mockRejectedValueOnce({code:'INVALID_OUTPUT',retryable:true}).mockResolvedValueOnce({parsed:'valid'});
 const task=runCompetitorSkill({skillSlug:'test',userId:1,context:'original',modelOverride:'configured'},(_error,_attempt,request)=>{request.context='correct missing featureIds';request.variables={context:request.context};});
 await vi.runAllTimersAsync();expect(await task).toEqual({parsed:'valid'});
 expect(run.mock.calls[1][0]).toMatchObject({context:'correct missing featureIds',variables:{context:'correct missing featureIds'},modelOverride:'configured',fallbackModels:[]});vi.useRealTimers();
});

it('recognizes nested retry metadata and can repair a locally identified validation failure',async()=>{
 vi.useFakeTimers();run.mockReset().mockRejectedValueOnce({cause:{cause:{code:'INVALID_OUTPUT',retryable:true}}}).mockResolvedValueOnce({parsed:'valid'});
 const nested=runCompetitorSkill({skillSlug:'test',userId:1,context:'original'});await vi.runAllTimersAsync();expect((await nested).parsed).toBe('valid');
 run.mockReset().mockRejectedValueOnce(new Error('wrapped validation failure')).mockResolvedValueOnce({parsed:'fixed'});
 const local=runCompetitorSkill({skillSlug:'test',userId:1,context:'original'},(_e,_attempt,request)=>{request.context='precise schema correction';},{validationFailed:()=>true});await vi.runAllTimersAsync();expect((await local).parsed).toBe('fixed');expect(run.mock.calls[1][0].context).toBe('precise schema correction');vi.useRealTimers();
});
