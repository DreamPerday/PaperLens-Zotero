import type { ImageAttachment } from '../types';

export const MAX_IMAGES = 4;
export const MAX_IMAGE_EDGE = 2048;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function imageDescription(images: ImageAttachment[]): string {
  return images.map((image, index) => `图片 ${index + 1}：${image.name}` +
    (image.location ? `（论文第${image.pageLabel || image.location.pageIndex + 1}页，引用 [图片 ${index + 1}](#image-${image.id})）` : '（用户提供的图片，未关联 PDF 位置）')).join('\n');
}

export function validateImages(images: ImageAttachment[]) {
  if (images.length > MAX_IMAGES) throw new Error(`一次最多添加 ${MAX_IMAGES} 张图片。`);
  for (const image of images) {
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(image.dataURL) || !image.width || !image.height) {
      throw new Error('图片格式无效，请使用 PNG、JPEG 或 WebP 图片。');
    }
    if (image.dataURL.length > 12 * 1024 * 1024) throw new Error('图片过大，请裁切后重新添加。');
  }
}

export async function readImage(file: File, doc: Document): Promise<ImageAttachment> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片。');
  if (file.size > 20 * 1024 * 1024) throw new Error('单张图片请小于 20 MB。');
  const win = doc.defaultView!;
  const dataURL = await new Promise<string>((resolve, reject) => {
    const reader = new win.FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败，请重试。'));
    reader.readAsDataURL(file);
  });
  const image = doc.createElement('img');
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('无法打开这张图片，请转换为 PNG 或 JPEG 后重试。'));
    image.src = dataURL;
  });
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = doc.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { id: win.crypto.randomUUID(), name: file.name || '粘贴的图片',
    dataURL: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}
