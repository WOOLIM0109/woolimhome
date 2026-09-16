import JSZip from 'jszip';
import sharp from 'sharp';

const escape = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const relationshipNs='xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const relationshipBase='http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function textShape({id,name=`Evidence ${id}`,title=false,text,font='Arial',x=600000,y=500000,
  width=6000000,height=1800000,placeholder,withoutFont=false}) {
  const ph=placeholder ? `<p:ph type="${placeholder.type || 'body'}"${placeholder.idx===undefined?'':` idx="${placeholder.idx}"`}/>` : (title?'<p:ph type="title"/>':'');
  const fontMarkup=withoutFont?'':`<a:latin typeface="${escape(font)}"/><a:ea typeface="${escape(font)}"/>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escape(name)}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR" sz="2800">${fontMarkup}</a:rPr><a:t>${escape(text)}</a:t></a:r><a:endParaRPr lang="ko-KR"/></a:p></p:txBody></p:sp>`;
}

function nestedGroupShape({font,id=20}) {
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Nested group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="900000" y="900000"/><a:ext cx="2500000" cy="1200000"/><a:chOff x="0" y="0"/><a:chExt cx="2500000" cy="1200000"/></a:xfrm></p:grpSpPr>${textShape({id:id+1,text:'Nested group evidence',font,x:100000,y:100000,width:1800000,height:700000})}</p:grpSp>`;
}

function tableShape({font,dense=false,id=30}) {
  const width=dense?14000000:2600000, height=dense?6500000:1200000;
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Evidence table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="300000" y="1700000"/><a:ext cx="${width}" cy="${height}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="${width}"/></a:tblGrid><a:tr h="${height}"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr><a:latin typeface="${escape(font)}"/><a:ea typeface="${escape(font)}"/></a:rPr><a:t>Table font evidence</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function pictureShape({id=40,relationshipId='rIdImage',width=7300000,height=5800000}) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Synthetic fixture image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="600000" y="1500000"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

async function syntheticImage(kind,variant=1) {
  if(kind==='broken') return Buffer.from(`not-an-image-${variant}`);
  if(kind==='illustration') {
    return sharp({create:{width:64,height:64,channels:3,background:variant%2?'#f05a24':'#1f70c1'}}).png().toBuffer();
  }
  let state=(0x9e3779b9 ^ variant)>>>0;
  const pixels=Buffer.alloc(64*64*3);
  for(let i=0;i<pixels.length;i++) {
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    pixels[i]=state>>>24;
  }
  return sharp(pixels,{raw:{width:64,height:64,channels:3}}).png().toBuffer();
}

/**
 * Minimal local-only OOXML evidence fixture. Never contains customer material
 * or credentials. Optional constructs exercise inheritance, groups, tables,
 * media classification and relationship normalization without launching COM.
 */
export async function pptxFixture({
  ratio=[16,9], count=18, fonts={}, hidden=[], empty=[], broken=[], duplicate=false,
  texts={}, titles={}, layoutOffsets={}, nestedGroupFonts={}, tableFonts={}, denseTables=[],
  pictureKinds={}, pictureVariants={}, backgroundPictureKinds={}, unresolvedFontSlides=[], uninspectableSlides=[],
  inheritance, absoluteRelationships=false, streamFiles=false, zipComment='',
}={}) {
  const zip=new JSZip();
  const ns='xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const widthEmu=Math.round(9144000*ratio[0]/ratio[1]), heightEmu=9144000;
  const inheritedSlides=new Set(inheritance?.slideNumbers || []);
  const contentTypes=[
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    ...Array.from({length:count},(_,i)=>`<Override PartName="/ppt/slides/slide${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`),
  ];
  if(inheritance) contentTypes.push(
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
  );
  zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${contentTypes.join('')}</Types>`);
  zip.file('_rels/.rels',`<Relationships ${relationshipNs}><Relationship Id="rId1" Type="${relationshipBase}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file('ppt/presentation.xml',`<p:presentation ${ns}><p:sldIdLst>${Array.from({length:count},(_,i)=>`<p:sldId id="${256+i}" r:id="rId${i+1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${widthEmu}" cy="${heightEmu}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels',`<Relationships ${relationshipNs}>${Array.from({length:count},(_,i)=>`<Relationship Id="rId${i+1}" Type="${relationshipBase}/slide" Target="${absoluteRelationships?'/ppt/slides': 'slides'}/slide${i+1}.xml"/>`).join('')}</Relationships>`);

  if(inheritance) {
    const themeLatin=escape(inheritance.themeLatin || 'Fixture Theme Latin');
    const themeEastAsian=escape(inheritance.themeEastAsian || 'Fixture Theme Korean');
    const placeholder=`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="7"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr></a:lstStyle><a:p/></p:txBody></p:sp>`;
    zip.file('ppt/slideLayouts/slideLayout1.xml',`<p:sldLayout ${ns}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm/></p:grpSpPr>${placeholder}</p:spTree></p:cSld></p:sldLayout>`);
    zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels',`<Relationships ${relationshipNs}><Relationship Id="rIdMaster" Type="${relationshipBase}/slideMaster" Target="${absoluteRelationships?'/ppt/slideMasters/slideMaster1.xml':'../slideMasters/slideMaster1.xml'}"/></Relationships>`);
    const masterStatic=inheritance.masterFont?nestedGroupShape({font:inheritance.masterFont,id:50}):'';
    zip.file('ppt/slideMasters/slideMaster1.xml',`<p:sldMaster ${ns}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm/></p:grpSpPr>${placeholder}${masterStatic}</p:spTree></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`);
    zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels',`<Relationships ${relationshipNs}><Relationship Id="rIdTheme" Type="${relationshipBase}/theme" Target="${absoluteRelationships?'/ppt/theme/theme1.xml':'../theme/theme1.xml'}"/></Relationships>`);
    zip.file('ppt/theme/theme1.xml',`<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture"><a:themeElements><a:clrScheme name="Fixture"/><a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="${themeLatin}"/><a:ea typeface=""/><a:font script="Hang" typeface="${themeEastAsian}"/></a:majorFont><a:minorFont><a:latin typeface="${themeLatin}"/><a:ea typeface=""/><a:font script="Hang" typeface="${themeEastAsian}"/></a:minorFont></a:fontScheme><a:fmtScheme name="Fixture"/></a:themeElements></a:theme>`);
  }

  const imageCache=new Map();
  for(let i=1;i<=count;i++) {
    if(broken.includes(i)) continue;
    const source=duplicate&&i===count?1:i;
    const font=fonts[source]||'Arial';
    const bodyText=texts[source]||`Evidence ${source} - no customer data. Shape and page-number checks.`;
    const inherited=inheritedSlides.has(i);
    const unresolved=unresolvedFontSlides.includes(i);
    const x=600000+(layoutOffsets[source]||0);
    const shape=(id,title,y)=>textShape({id,title,text:title?(titles[source]||`Local QA slide ${source}`):bodyText,font,x,y,
      placeholder:inherited&&!title?{type:'body',idx:7}:undefined,withoutFont:(inherited&&!title)||unresolved});
    const extra=[];
    if(nestedGroupFonts[source]) extra.push(nestedGroupShape({font:nestedGroupFonts[source]}));
    if(tableFonts[source]) extra.push(tableShape({font:tableFonts[source],dense:denseTables.includes(i)}));
    const pictureKind=pictureKinds[source];
    const backgroundPictureKind=backgroundPictureKinds[source];
    const relationships=[];
    let backgroundMarkup='';
    if(inheritance) relationships.push(`<Relationship Id="rIdLayout" Type="${relationshipBase}/slideLayout" Target="${absoluteRelationships?'/ppt/slideLayouts/slideLayout1.xml':'../slideLayouts/slideLayout1.xml'}"/>`);
    if(backgroundPictureKind) {
      const variant=pictureVariants[source]||1;
      const imageName=`background-${backgroundPictureKind}-${variant}.png`;
      if(!imageCache.has(imageName)) imageCache.set(imageName,await syntheticImage(backgroundPictureKind,variant));
      zip.file(`ppt/media/${imageName}`,imageCache.get(imageName));
      relationships.push(`<Relationship Id="rIdBackground" Type="${relationshipBase}/image" Target="${absoluteRelationships?`/ppt/media/${imageName}`:`../media/${imageName}`}"/>`);
      backgroundMarkup='<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rIdBackground"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>';
    }
    if(pictureKind) {
      const variant=pictureVariants[source]||1;
      const imageName=`${pictureKind}-${variant}.png`;
      if(!imageCache.has(imageName)) imageCache.set(imageName,await syntheticImage(pictureKind,variant));
      zip.file(`ppt/media/${imageName}`,imageCache.get(imageName));
      relationships.push(`<Relationship Id="rIdImage" Type="${relationshipBase}/image" Target="${absoluteRelationships?`/ppt/media/${imageName}`:`../media/${imageName}`}"/>`);
      extra.push(pictureShape({width:Math.round(widthEmu*.8),height:Math.round(heightEmu*.8)}));
    }
    if(uninspectableSlides.includes(i)) extra.push('<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="90" name="Unsupported object"/><p:cNvGraphicFramePr/><p:nvPr><p:videoFile r:link="rIdUnsupported"/></p:nvPr></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></p:xfrm><a:graphic><a:graphicData uri="fixture:unsupported"/></a:graphic></p:graphicFrame>');
    zip.file(`ppt/slides/slide${i}.xml`,`<p:sld ${ns}${hidden.includes(i)?' show="0"':''}><p:cSld>${backgroundMarkup}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${empty.includes(i)?'':shape(2,true,500000)+shape(3,false,3000000)+extra.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    if(relationships.length) zip.file(`ppt/slides/_rels/slide${i}.xml.rels`,`<Relationships ${relationshipNs}>${relationships.join('')}</Relationships>`);
  }
  zip.comment=zipComment;
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',streamFiles});
}
