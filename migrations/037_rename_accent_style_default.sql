-- Rename default accent theme slug after ARCARNA rebrand.
UPDATE organizations SET accent_style = 'arcarna' WHERE accent_style = 'midnight';
