-- ============================================================================
--  Beispielszenarien
--
--  Optional. Legt fuer ein bestehendes Konto drei Szenarien an, damit die KI
--  vom ersten Abruf an brauchbare Entwuerfe schreibt. Ohne Szenarien faellt
--  sie auf eine allgemeine Vorlage zurueck.
--
--  Vor dem Ausfuehren die E-Mail-Adresse unten anpassen.
-- ============================================================================

DO $$
DECLARE
  ziel_email    TEXT := 'deine@adresse.de';   -- <<< anpassen
  ziel_user     UUID;
  kat_retouren  UUID;
  kat_produkt   UUID;
  kat_support   UUID;
BEGIN
  SELECT id INTO ziel_user FROM public.profiles WHERE email = ziel_email;

  IF ziel_user IS NULL THEN
    RAISE NOTICE 'Kein Profil fuer % gefunden. Erst in der App anmelden, dann dieses Skript erneut ausfuehren.', ziel_email;
    RETURN;
  END IF;

  SELECT id INTO kat_retouren FROM public.categories WHERE user_id = ziel_user AND name = 'Retouren';
  SELECT id INTO kat_produkt  FROM public.categories WHERE user_id = ziel_user AND name = 'Produkt';
  SELECT id INTO kat_support  FROM public.categories WHERE user_id = ziel_user AND name = 'Kundensupport';

  INSERT INTO public.scenarios (user_id, title, trigger_keywords, example_response, category_id)
  VALUES
    (
      ziel_user,
      'Retourenfrage',
      '["rücksendung","retoure","zurückschicken","umtausch","widerruf","zurückgeben"]'::jsonb,
      E'vielen Dank für Ihre Nachricht.\n\n'
      'Selbstverständlich können Sie den Artikel innerhalb von 14 Tagen nach Erhalt zurücksenden. '
      'Legen Sie die Ware bitte ungetragen und mit Etikett in die Originalverpackung und nutzen Sie '
      E'das beiliegende Retourenlabel.\n\n'
      'Sobald das Paket bei uns eingetroffen ist, erstatten wir Ihnen den Betrag innerhalb von '
      '5 Werktagen auf Ihr ursprüngliches Zahlungsmittel.',
      kat_retouren
    ),
    (
      ziel_user,
      'Lieferstatus',
      '["wo ist meine bestellung","lieferung","versand","sendungsverfolgung","paket","noch nicht erhalten"]'::jsonb,
      E'vielen Dank für Ihre Nachricht.\n\n'
      'Ich habe Ihre Bestellung nachgesehen: Das Paket wurde bereits an unseren Versanddienstleister '
      E'übergeben und ist auf dem Weg zu Ihnen. Üblicherweise dauert die Zustellung 2 bis 4 Werktage.\n\n'
      'Die Sendungsverfolgung haben Sie separat per E-Mail erhalten. Sollte das Paket nicht ankommen, '
      'melden Sie sich bitte kurz - dann kümmere ich mich sofort darum.',
      kat_support
    ),
    (
      ziel_user,
      'Größenberatung',
      '["größe","passform","fällt aus","maße","welche größe","zu klein","zu groß"]'::jsonb,
      E'vielen Dank für Ihre Nachricht und Ihr Interesse.\n\n'
      'Unsere Artikel fallen grundsätzlich normal aus. Wenn Sie zwischen zwei Größen liegen, '
      E'empfehle ich die größere - so sitzt das Stück angenehmer.\n\n'
      'In der Größentabelle auf der Produktseite finden Sie die genauen Maße zum Nachmessen. '
      'Und falls die Größe doch nicht passt, ist der Umtausch für Sie kostenlos.',
      kat_produkt
    )
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Szenarien fuer % angelegt.', ziel_email;
END;
$$;
