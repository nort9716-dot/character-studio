import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json({limit:'25mb'}));

app.get('/api/health', (_req,res)=>res.json({ok:true,configured:Boolean(process.env.OPENAI_API_KEY)}));

app.post('/api/generate', async (req,res)=>{
  try {
    if(!process.env.OPENAI_API_KEY) return res.status(503).json({error:'OPENAI_API_KEY is not configured on the server.'});
    const prompt=String(req.body?.prompt||'').trim();
    if(!prompt) return res.status(400).json({error:'Prompt is required.'});
    const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
    const reference=req.body?.reference;
    const result=await client.images.generate({
      model:'gpt-image-2',
      prompt,
      size:req.body?.size||'1024x1536',
      quality:req.body?.quality||'high',
      ...(reference?{input_fidelity:'high'}:{})
    });
    const image=result?.data?.[0]?.b64_json;
    if(!image) return res.status(502).json({error:'Image generation returned no image data.'});
    res.json({image:`data:image/png;base64,${image}`});
  } catch(err) {
    console.error(err);
    res.status(500).json({error:err?.message||'Generation failed.'});
  }
});

const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log(`Character Studio backend listening on ${port}`));
