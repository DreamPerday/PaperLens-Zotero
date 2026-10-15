"""Generate synthetic public-domain test papers; never read a personal library."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import simpleSplit

root = Path(__file__).resolve().parents[1] / "output" / "zotero-dev"
root.mkdir(parents=True, exist_ok=True)
pdf = canvas.Canvas(str(root / "synthetic-paper.pdf"), pagesize=(612, 792))
pdf.setTitle("Synthetic Paper: Retrieval and Scientific Questions")

def heading(text, y, size=15, x=54):
    pdf.setFont("Helvetica-Bold", size)
    pdf.drawString(x, y, text)
    return y - size - 14

def paragraph(text, y, x=54, width=500):
    pdf.setFont("Times-Roman", 11)
    for line in simpleSplit(text, "Times-Roman", 11, width):
        pdf.drawString(x, y, line)
        y -= 15
    return y - 15

def footer(page):
    pdf.setFont("Helvetica", 9)
    pdf.drawString(54, 35, "Synthetic example for PaperLens integration testing. No real experiment.")
    pdf.drawRightString(558, 35, str(page))

y = heading("When Does Retrieval Improve Scientific Answers?", 735, 18)
y = heading("1. Introduction", y)
y = paragraph("This synthetic paper investigates whether retrieving relevant passages improves the evidence coverage of scientific answers. It is a fixture, and all findings below are illustrative.", y)
y = paragraph("The central question is whether answer quality changes because of retrieval, rather than changes to the generation model. The study uses the same generator in all conditions.", y)
y = heading("2. Methods", y)
y = paragraph("To isolate the effect of retrieval, we keep the generation model fixed across all experiments. The prompt, decoding parameters, and evaluation rules also remain constant.", y)
y = paragraph("Each query retrieves five passages from the same corpus. Answers are evaluated against cited source passages. The comparison includes relevant retrieval, irrelevant retrieval, and no retrieval.", y)
y = paragraph("The first outcome is evidence coverage. The second is unsupported statement rate. These measures do not establish clinical benefit, real-world utility, or performance on other corpora.", y)
footer(1); pdf.showPage()
y = heading("3. Results", 735)
y = paragraph("Relevant retrieval improves evidence coverage in this synthetic example. Irrelevant passages may reduce answer quality even when the number of retrieved passages is unchanged.", y)
y = paragraph("A higher evidence coverage score does not imply that every answer is correct. Some answers include unsupported claims. We therefore report unsupported statement rate alongside coverage.", y)
y = heading("4. Limitations", y)
y = paragraph("Only one generation model and one corpus are evaluated. Generalization to other domains, models, and retrieval systems has not been verified. This limitation qualifies the result in Section 3.", y)
y = paragraph("The evaluation measures citation support rather than complete factual truth. A supported answer may inherit an error from the cited passage. External validation is outside the scope of this fixture.", y)
y = heading("5. Conclusion", y)
y = paragraph("The example supports a conditional claim: relevant retrieval can improve evidence coverage under the tested conditions. It does not support the claim that retrieval always improves accuracy.", y)
footer(2); pdf.save()

pdf = canvas.Canvas(str(root / "two-column-paper.pdf"), pagesize=(612, 792))
heading("Synthetic Two-Column Reading Test", 735, 18)
for x, title in [(54, "Left Column: Methods"), (318, "Right Column: Results")]:
    y = heading(title, 685, 12, x)
    for i in range(6):
        y = paragraph(f"Paragraph {i+1}. The {title.split(':')[1].strip().lower()} section uses synthetic text to verify reading order and precise source positions in a two-column PDF.", y, x=x, width=235)
footer(1); pdf.save()

# A PDF with no text layer must produce a useful empty-text state.
pdf = canvas.Canvas(str(root / "no-text-layer.pdf"), pagesize=(612, 792))
pdf.setFillColorRGB(.8, .85, .9)
pdf.rect(80, 150, 450, 500, fill=1, stroke=0)
pdf.save()

pdf = canvas.Canvas(str(root / "long-paper.pdf"), pagesize=(612, 792))
for page in range(1, 9):
    y = heading(f"Synthetic Long Paper: Section {page}", 735, 16)
    for index in range(7):
        y = paragraph(f"Section {page}, paragraph {index+1}. This synthetic passage describes a controlled retrieval comparison. The generation model, prompt, corpus, and evaluation rules remain fixed. Relevant and irrelevant passages are compared for evidence coverage. The findings are illustrative and do not establish broader factual accuracy or clinical usefulness.", y)
    footer(page)
    pdf.showPage()
pdf.save()
print(root)
