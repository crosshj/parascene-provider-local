

https://www.parascene.com/s/v1/AAShAAAa.8-_DNk29yM9p/tadcbl

SD 3/Flux
```
{
"6": { "class_type": "CLIPTextEncode", "inputs": { "clip": [ "40", 0 ],
     "text": ""
}},
"30": { "class_type": "CheckpointLoaderSimple", "inputs": {
      "ckpt_name": "flux1-dev-fp8.safetensors",
      "ckpt_name_bak": "OpenFlux-fp8_e4m3fn.safetensors"
}},
"40": { "class_type": "CLIPLoader", "inputs": {
      "clip_name": "t5xxl_fp16.safetensors",
      "type": "sd3"
}},
"41": { "class_type": "VAELoader", "inputs": {
      "vae_name": "ae.safetensors"
}},
"31": { "class_type": "KSampler", "inputs": {
      "seed": 1119851866655636,
      "steps": 40,
      "cfg": 1,
      "sampler_name": "euler",
      "sampler_name_bak": "dpmpp_2m",
      "scheduler": "beta",
      "denoise": 1,
      "model": ["30", 0 ],
      "positive": [ "35", 0 ],
      "negative": [ "33", 0 ],
      "latent_image": ["27", 0 ]
}},
"35": { "class_type": "FluxGuidance", "inputs": { "guidance": 3.5, "conditioning": ["6",0] }},
"27": { "class_type": "EmptySD3LatentImage", "inputs": { "width": 1024, "height": 1024, "batch_size": 1 }},
"8": { "class_type": "VAEDecode", "inputs": { "samples": ["31", 0 ], "vae": ["41", 0 ] }},
"9": { "class_type": "SaveImage", "inputs": { "filename_prefix": "ComfyUI", "images": ["8", 0] }},
"33": { "class_type": "CLIPTextEncode", "inputs": { "text": "", "clip": ["40", 0 ] }}
}
```


SD 1.5
```
{
"6": { "class_type": "CLIPTextEncode", "inputs": {
      "clip": [ "30", 1 ],
      "text": "Slow motion chrome liquid splash in the Crystal catacombs, Stephen Gammell, Brian Froud, Robert Williams, Craola Simkins"
}},
"30": { "class_type": "CheckpointLoaderSimple", "inputs": {
      "ckpt_name": "dreamshaper_8.safetensors"
}},
"31": { "class_type": "KSampler", "inputs": {
      "seed": 1119851866655636,
      "steps": 30,
      "cfg": 7,
      "sampler_name": "dpmpp_2m",
      "scheduler": "normal",
      "denoise": 1,
      "model": ["30", 0 ],
      "positive": [ "6", 0 ],
      "negative": [ "33", 0 ],
      "latent_image": ["27", 0 ]
}},
"27": { "class_type": "EmptyLatentImage", "inputs": {
      "width": 768,
      "height": 768,
      "batch_size": 1
}},
"8": { "class_type": "VAEDecode", "inputs": {
      "samples": ["31", 0 ],
      "vae": ["30", 2 ]
}},
"9": { "class_type": "SaveImage", "inputs": {
      "filename_prefix": "ComfyUI",
      "images": ["8", 0]
}},
"33": { "class_type": "CLIPTextEncode", "inputs": {
      "text": "",
      "clip": ["30", 1 ]
}}
}
```


SD 1.5 Upscale to 1024
```
{
"6": { "class_type": "CLIPTextEncode", "inputs": {
      "clip": [ "30", 1 ],
      "text": "Slow motion chrome liquid splash in the Crystal catacombs, Stephen Gammell, Brian Froud, Robert Williams, Craola Simkins"
}},
"30": { "class_type": "CheckpointLoaderSimple", "inputs": {
      "ckpt_name": "dreamshaper_8.safetensors"
}},
"31": { "class_type": "KSampler", "inputs": {
      "seed": 1119851866655636,
      "steps": 28,
      "cfg": 7,
      "sampler_name": "dpmpp_2m",
      "scheduler": "normal",
      "denoise": 1,
      "model": ["30", 0 ],
      "positive": [ "6", 0 ],
      "negative": [ "33", 0 ],
      "latent_image": ["27", 0 ]
}},
"27": { "class_type": "EmptyLatentImage", "inputs": {
      "width": 768,
      "height": 768,
      "batch_size": 1
}},
"50": { "class_type": "LatentUpscale", "inputs": {
      "samples": ["31", 0],
      "width": 1024,
      "height": 1024,
      "upscale_method": "nearest-exact",
      "crop": "disabled"
}},
"51": { "class_type": "KSampler", "inputs": {
      "seed": 1119851866655636,
      "steps": 18,
      "cfg": 7,
      "sampler_name": "dpmpp_2m",
      "scheduler": "normal",
      "denoise": 0.45,
      "model": ["30", 0 ],
      "positive": [ "6", 0 ],
      "negative": [ "33", 0 ],
      "latent_image": ["50", 0 ]
}},
"8": { "class_type": "VAEDecode", "inputs": {
      "samples": ["51", 0 ],
      "vae": ["30", 2 ]
}},
"9": { "class_type": "SaveImage", "inputs": {
      "filename_prefix": "ComfyUI",
      "images": ["8", 0]
}},
"33": { "class_type": "CLIPTextEncode", "inputs": {
      "text": "",
      "clip": ["30", 1 ]
}}
}