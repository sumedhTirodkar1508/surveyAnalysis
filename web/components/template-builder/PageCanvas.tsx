"use client";

import React, { useEffect, useRef, useState } from "react";
import * as fabric from "fabric";

export interface BoundingBox {
  id?: string;
  x: number; // 0..1
  y: number; // 0..1
  w: number; // 0..1
  h: number; // 0..1
  color?: string;
}

interface PageCanvasProps {
  imageUrl: string;
  boxes: BoundingBox[];
  onBoxCreate?: (box: BoundingBox) => void;
  onBoxUpdate?: (id: string, box: Partial<BoundingBox>) => void;
  onBoxDelete?: (id: string) => void;
  selectedBoxId?: string | null;
  onBoxSelect?: (id: string | null) => void;
}

export function PageCanvas({
  imageUrl,
  boxes,
  onBoxCreate,
  onBoxUpdate,
  onBoxDelete,
  selectedBoxId,
  onBoxSelect,
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [tempRect, setTempRect] = useState<fabric.Rect | null>(null);

  // Initialize canvas
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      selection: false,
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;

    // Load background image
    fabric.Image.fromURL(imageUrl).then((img) => {
      const containerWidth = containerRef.current?.clientWidth || 800;
      const scale = containerWidth / (img.width || 800);
      
      canvas.setDimensions({
        width: containerWidth,
        height: (img.height || 1100) * scale,
      });

      img.set({
        scaleX: scale,
        scaleY: scale,
        originX: 'left',
        originY: 'top'
      });
      
      canvas.backgroundImage = img;
      canvas.renderAll();
    }).catch(err => console.error("Failed to load image", err));

    return () => {
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [imageUrl]);

  // Sync boxes from props
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // Remove existing rects
    const objects = canvas.getObjects("rect");
    objects.forEach(obj => {
      if (obj !== tempRect) canvas.remove(obj);
    });

    const w = canvas.width || 1;
    const h = canvas.height || 1;

    // Add boxes
    boxes.forEach(b => {
      const rect = new fabric.Rect({
        left: b.x * w,
        top: b.y * h,
        width: b.w * w,
        height: b.h * h,
        fill: b.color ? `${b.color}40` : "rgba(0, 100, 255, 0.2)",
        stroke: b.color || "rgba(0, 100, 255, 0.8)",
        strokeWidth: selectedBoxId === b.id ? 2 : 1,
        transparentCorners: false,
        cornerColor: "blue",
        cornerSize: 8,
        hasControls: true,
        hasBorders: true,
        lockRotation: true,
      });
      // @ts-ignore
      rect.boxId = b.id;
      canvas.add(rect);

      if (selectedBoxId === b.id) {
        canvas.setActiveObject(rect);
      }
    });

    canvas.renderAll();
  }, [boxes, selectedBoxId, tempRect]);

  // Event handlers
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handleMouseDown = (opt: any) => {
      const evt = opt.e;
      if (opt.target) {
        // Clicked an existing object
        // @ts-ignore
        if (opt.target.boxId && onBoxSelect) {
          // @ts-ignore
          onBoxSelect(opt.target.boxId);
        }
        return;
      }

      // Start drawing
      setIsDrawing(true);
      const pointer = opt.scenePoint || opt.pointer;
      setStartPos({ x: pointer.x, y: pointer.y });
      
      const rect = new fabric.Rect({
        left: pointer.x,
        top: pointer.y,
        width: 0,
        height: 0,
        fill: "rgba(255, 0, 0, 0.2)",
        stroke: "red",
        strokeWidth: 1,
        selectable: false,
      });
      canvas.add(rect);
      setTempRect(rect);
    };

    const handleMouseMove = (opt: any) => {
      if (!isDrawing || !startPos || !tempRect) return;
      
      const pointer = opt.scenePoint || opt.pointer;
      const w = Math.abs(pointer.x - startPos.x);
      const h = Math.abs(pointer.y - startPos.y);
      const left = Math.min(startPos.x, pointer.x);
      const top = Math.min(startPos.y, pointer.y);

      tempRect.set({ left, top, width: w, height: h });
      canvas.renderAll();
    };

    const handleMouseUp = () => {
      if (!isDrawing || !tempRect) return;
      
      setIsDrawing(false);
      const wCanvas = canvas.width || 1;
      const hCanvas = canvas.height || 1;

      const w = tempRect.width || 0;
      const h = tempRect.height || 0;
      const left = tempRect.left || 0;
      const top = tempRect.top || 0;

      canvas.remove(tempRect);
      setTempRect(null);

      // Ignore tiny boxes
      if (w > 5 && h > 5 && onBoxCreate) {
        onBoxCreate({
          x: left / wCanvas,
          y: top / hCanvas,
          w: w / wCanvas,
          h: h / hCanvas,
        });
      }
    };

    const handleObjectModified = (opt: any) => {
      const target = opt.target;
      if (!target || !onBoxUpdate) return;
      // @ts-ignore
      const id = target.boxId;
      if (!id) return;

      const wCanvas = canvas.width || 1;
      const hCanvas = canvas.height || 1;

      const scaleX = target.scaleX || 1;
      const scaleY = target.scaleY || 1;
      
      const newBox = {
        x: (target.left || 0) / wCanvas,
        y: (target.top || 0) / hCanvas,
        w: ((target.width || 0) * scaleX) / wCanvas,
        h: ((target.height || 0) * scaleY) / hCanvas,
      };

      // Reset scale so width/height is true value
      target.set({
        width: target.width! * scaleX,
        height: target.height! * scaleY,
        scaleX: 1,
        scaleY: 1
      });
      
      onBoxUpdate(id, newBox);
    };

    canvas.on("mouse:down", handleMouseDown);
    canvas.on("mouse:move", handleMouseMove);
    canvas.on("mouse:up", handleMouseUp);
    canvas.on("object:modified", handleObjectModified);

    return () => {
      canvas.off("mouse:down", handleMouseDown);
      canvas.off("mouse:move", handleMouseMove);
      canvas.off("mouse:up", handleMouseUp);
      canvas.off("object:modified", handleObjectModified);
    };
  }, [isDrawing, startPos, tempRect, onBoxCreate, onBoxUpdate, onBoxSelect]);

  // Keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!fabricRef.current) return;
      const canvas = fabricRef.current;
      const activeObj = canvas.getActiveObject();
      if (!activeObj) return;

      const step = e.shiftKey ? 10 : 1;
      let moved = false;

      switch(e.key) {
        case 'ArrowUp': activeObj.top! -= step; moved = true; break;
        case 'ArrowDown': activeObj.top! += step; moved = true; break;
        case 'ArrowLeft': activeObj.left! -= step; moved = true; break;
        case 'ArrowRight': activeObj.left! += step; moved = true; break;
        case 'Delete':
        case 'Backspace':
          // @ts-ignore
          if (onBoxDelete && activeObj.boxId) {
            // @ts-ignore
            onBoxDelete(activeObj.boxId);
            canvas.remove(activeObj);
            e.preventDefault();
          }
          break;
      }

      if (moved) {
        activeObj.setCoords();
        canvas.renderAll();
        e.preventDefault();
        
        // Trigger modified
        canvas.fire('object:modified', { target: activeObj });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBoxDelete]);

  return (
    <div ref={containerRef} className="w-full border rounded bg-neutral-100 overflow-hidden relative">
      <canvas ref={canvasRef} />
    </div>
  );
}
