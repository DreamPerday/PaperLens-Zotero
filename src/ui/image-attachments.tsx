import React from 'react';
import type { ImageAttachment } from '../types';

export function ImageAttachments({ images, onRemove, onNavigate }: {
  images: ImageAttachment[]; onRemove?: (id: string) => void; onNavigate: (id: string) => void;
}) {
  return <div className="image-attachments">{images.map(image => <div className="image-attachment" key={image.id}>
    <details className="image-preview">
      <summary title={`展开查看：${image.name}`}><img src={image.dataURL} alt={image.name}/><span>{image.name}</span></summary>
      <img className="image-expanded" src={image.dataURL} alt={image.name}/>
    </details>
    <div className="image-attachment-actions">
      {image.location ? <button className="text-button" title="定位原图" onClick={() => onNavigate(image.id)}>第 {image.pageLabel || image.location.pageIndex + 1} 页 ↗</button>
        : <span>用户图片</span>}
    </div>
    {onRemove && <button className="image-remove" title="移除图片" aria-label={`移除图片：${image.name}`} onClick={() => onRemove(image.id)}>×</button>}
  </div>)}</div>;
}
