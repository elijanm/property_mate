# @trainer
# Name: Disposable Email Detector
# Version: 1.0.0
# Author: Mldock Team
# Description: Detects fake, disposable, and throwaway email addresses
# Framework: sklearn
# License: MIT
# Tags: email, fraud, disposable, throwaway, classification

"""
DisposableEmailDetector — classifies email addresses as disposable/fake or legitimate.

How it works:
  Layer 1 — Domain blocklist:   checks against 2500+ known disposable email domains
  Layer 2 — Pattern analysis:   detects random strings, excessive numbers, suspicious TLDs
  Layer 3 — Heuristic scoring:  domain age proxies, MX-like checks, structural patterns
  Layer 4 — ML classifier:      trained on labelled examples if provided (optional)

No training data required — works zero-shot via blocklist + heuristics.
Optionally upload labelled emails to fine-tune the ML layer.

requirements.txt:
  scikit-learn
  numpy
  tldextract

Dataset: optional — upload labelled emails to improve ML layer accuracy.
Inference input: {"email": str}
Inference output: {
    "is_disposable": bool,
    "risk_score": float,        # 0.0 (legitimate) to 1.0 (disposable)
    "confidence": str,          # certain / high / medium / low
    "reasons": list,            # why it was flagged
    "domain": str,
    "checks": dict              # per-layer results
}
"""

import re,asyncio
import numpy as np
from app.abstract.base_trainer import BaseTrainer, TrainingConfig, EvaluationResult, TrainerBundle
from app.abstract.data_source import UrlDatasetDataSource
import logging
import asyncio
import sys
logger = logging.getLogger("runner")
logger.setLevel(logging.INFO)
logger.addHandler(logging.StreamHandler(sys.stdout))

class DisposableEmailDetector(BaseTrainer):
    name        = "throwaway_email_detector"
    version     = "1.0.0"
    description = "Detects fake, disposable, and throwaway email addresses using blocklist + heuristics + ML."
    framework   = "sklearn"
    category    = {"key": "text-classification", "label": "Text Classification"}
    schedule    = None

    data_source = UrlDatasetDataSource(
      name="Disposable Email Detector",
      # ── Required ──────────────────────────────────────────────────────────────
      slug="disposable-email-data",          # unique per org; used to find/create the record
      source_url="https://disposable.github.io/disposable-email-domains/domains.json",
      # ── Fetch schedule ────────────────────────────────────────────────────────
      refresh_interval_hours=24,             # how often scheduler re-fetches (0 = never re-fetch)

      # ── Media JSON arrays ─────────────────────────────────────────────────────
      url_field="image_url",                 # if JSON array of objects, field holding media URL
                                             # → each URL is downloaded + stored individually
      max_items=None,                        # cap how many items to download (None = unlimited)

      # ── Behaviour ─────────────────────────────────────────────────────────────
      allow_empty=True,                      # don't raise if dataset has no entries yet

      # ── Change-detection hooks ────────────────────────────────────────────────
    #   on_change_retrain="your_trainer_name", # slug of trainer to auto-retrain when content changes
    #   on_change_webhook_url="https://...",   # POST notification when content hash changes

      # ── UI visibility ─────────────────────────────────────────────────────────
      auto_create_spec={
          "name": "...",
          "description": "...",
          "category": "training",            # optional, defaults to "url_dataset"
          "fields": [
              {"label": "Email",   "type": "text",   "required": True},
              {"label": "Label",   "type": "select", "required": True,
               "options": ["disposable", "legitimate"]},  # shown as description_presets
              {"label": "Notes",   "type": "text",   "required": False},
              # type can be: text, number, image, video, media, file, select
              # other per-field keys: instruction, repeatable, max_repeats
          ],
      }
        

    )


    input_schema = {
        "email": {
            "type":        "text",
            "label":       "Email Address",
            "description": "Email address to check.",
            "required":    True,
        },
    }

    output_schema = {
        "is_disposable": {"type": "bool",  "label": "Is Disposable"},
        "risk_score":    {"type": "float", "label": "Risk Score (0-1)"},
        "confidence":    {"type": "str",   "label": "Confidence (certain/high/medium/low)"},
        "reasons":       {"type": "list",  "label": "Flagged Reasons"},
        "domain":        {"type": "str",   "label": "Email Domain"},
        "checks":        {"type": "dict",  "label": "Per-Layer Check Results"},
    }

    # ------------------------------------------------------------------
    # Known disposable email domains (2500+ domains)
    # Top providers + auto-generated patterns
    # ------------------------------------------------------------------

    DISPOSABLE_DOMAINS = {
        # Major throwaway providers
        "mailinator.com", "guerrillamail.com", "guerrillamail.net",
        "guerrillamail.org", "guerrillamail.de", "guerrillamail.info",
        "guerrillamail.biz", "sharklasers.com", "guerrillamailblock.com",
        "grr.la", "guerrillamailblock.com", "spam4.me", "trashmail.com",
        "trashmail.me", "trashmail.net", "trashmail.at", "trashmail.io",
        "trashmail.org", "trashmail.xyz", "trashmailer.com", "trash-mail.at",
        "yopmail.com", "yopmail.fr", "cool.fr.nf", "jetable.fr.nf",
        "nospam.ze.tc", "nomail.xl.cx", "mega.zik.dj", "speed.1s.fr",
        "courriel.fr.nf", "moncourrier.fr.nf", "monemail.fr.nf",
        "monmail.fr.nf", "10minutemail.com", "10minutemail.net",
        "10minutemail.org", "10minutemail.de", "10minutemail.co.uk",
        "10minemail.com", "10minutemail.cf", "10minutemail.ga",
        "10minutemail.gq", "10minutemail.ml", "10minutemail.tk",
        "tempmail.com", "tempmail.net", "tempmail.org", "tempmail.de",
        "temp-mail.org", "temp-mail.com", "temp-mail.io", "temp-mail.ru",
        "tempinbox.com", "tempr.email", "tempm.com", "tempsky.com",
        "throwam.com", "throwam.net", "throwaway.email", "throwam.org",
        "dispostable.com", "disposeamail.com", "disposableemailaddresses.com",
        "mailnull.com", "mailnull.net", "spamgourmet.com", "spamgourmet.net",
        "spamgourmet.org", "spamex.com", "spamfree24.org", "spamfree24.de",
        "spamfree24.eu", "spamfree24.info", "spamfree24.net",
        "mailnesia.com", "mailnull.com", "mailscrap.com", "maildrop.cc",
        "maildrops.cc", "mailexpire.com", "mailfreeonline.com",
        "mailguard.me", "mailhazard.com", "mailimate.com", "mailin8r.com",
        "mailinater.com", "mailinator.net", "mailinator.org",
        "mailinator2.com", "mailincubator.com", "mailismagic.com",
        "mailme.ir", "mailme.lv", "mailme24.com", "mailmetrash.com",
        "mailmoat.com", "mailnew.com", "mailnull.com", "mailpick.biz",
        "mailrock.biz", "mailscrap.com", "mailshell.com", "mailsiphon.com",
        "mailslite.com", "mailspeed.net", "mailtemp.info", "mailtome.de",
        "mailtothis.com", "mailtrash.net", "mailtv.tv", "mailwall.net",
        "mailwithyou.com", "mailzilla.com", "mailzilla.org",
        "discard.email", "discardmail.com", "discardmail.de",
        "fakeinbox.com", "fakemail.fr", "fakemailgenerator.com",
        "fake-box.com", "fakeemailgenerator.com", "fakenews.li",
        "filzmail.com", "filzmail.de",
        "getonemail.com", "getonemail.net",
        "ghosttexter.de", "girlsundertheinfluence.com",
        "gishpuppy.com", "gmal.com",
        "harakirimail.com", "hat-gmbh.de", "hatespam.org",
        "herp.in", "hidemail.de", "hidzz.com",
        "hmamail.com", "hopemail.biz",
        "ieatspam.eu", "ieatspam.info",
        "ihateyoualot.info", "iheartspam.org",
        "imails.info", "inboxalias.com",
        "inboxclean.com", "inboxclean.org",
        "jetable.com", "jetable.fr.nf", "jetable.net", "jetable.org",
        "junk.to", "junkmail.gq", "junkmail.ro",
        "kasmail.com", "kaspop.com",
        "killmail.com", "killmail.net",
        "klzlk.com", "koszmail.pl",
        "kurzepost.de",
        "letthemeatspam.com", "lol.ovpn.to",
        "lookugly.com", "lortemail.dk",
        "lovemeleaveme.com", "lr78.com",
        "lukop.dk",
        "maileater.com", "mailexpire.com",
        "meltmail.com", "momentics.ru",
        "moncourrier.fr.nf", "monemail.fr.nf",
        "monmail.fr.nf", "mt2009.com",
        "mx0.wwwnew.eu",
        "mytrashmail.com", "mytrashmail.net",
        "neomailbox.com", "nepwk.com",
        "nervmich.net", "nervtmich.net",
        "netmails.com", "netmails.net",
        "nevermail.de", "ninfcm.com",
        "no-spam.ws", "noblepioneer.com",
        "nomail.pw", "nomail.xl.cx",
        "nomail2me.com", "nomorespamemails.com",
        "nonspam.eu", "nonspammer.de",
        "nospam.ze.tc", "nospam4.us",
        "nospamfor.us", "nospammail.net",
        "nospamthanks.info", "notmailinator.com",
        "nowhere.org", "nowmymail.com",
        "objectmail.com", "obobbo.com",
        "odaymail.com", "odnorazovoe.ru",
        "one-time.email", "oneoffemail.com",
        "onewaymail.com", "onlatedotcom.info",
        "online.ms", "oopi.org",
        "ordinaryamerican.net", "otherinbox.com",
        "owlpic.com",
        "paplease.com", "pcusers.otherinbox.com",
        "pepbot.com", "pfui.ru",
        "phentermine-mortgages.com", "pimpedupmyride.com",
        "pjjkp.com", "plexolan.de",
        "poczta.onet.pl", "politikerclub.de",
        "poofy.org", "pookmail.com",
        "privacy.net", "privatdemail.net",
        "proxymail.eu", "prtnx.com",
        "prtz.eu", "publicmail.eu",
        "put2.net", "putthisinyourspamdatabase.com",
        "pwrby.com",
        "quickinbox.com", "quickmail.nl",
        "rcpt.at", "reallymymail.com",
        "receiveee.com", "recursor.net",
        "recyclemail.dk",
        "regbypass.com", "regbypass.comsafe-mail.net",
        "rejo.technology", "reliable-mail.com",
        "rhyta.com", "rklips.com",
        "rmqkr.net", "royal.net",
        "rppkn.com", "rtrtr.com",
        "s0ny.net", "safe-mail.net",
        "safersignup.de", "safetymail.info",
        "safetypost.de", "sandelf.de",
        "saynotospams.com", "schafmail.de",
        "schrott-email.de", "secretemail.de",
        "secure-mail.biz", "selfdestructingmail.com",
        "sendspamhere.com", "senseless-entertainment.com",
        "sharklasers.com", "shieldedmail.com",
        "shitmail.me", "shitware.nl",
        "shmeriously.com", "shortmail.net",
        "sibmail.com", "sinnlos-mail.de",
        "skeefmail.com", "slapsfromlastnight.com",
        "slaskpost.se", "slave-auctions.net",
        "slopsbox.com", "smellfear.com",
        "smwg.info", "snakemail.com",
        "sneakemail.com", "sneakmail.de",
        "snkmail.com", "sofimail.com",
        "sofort-mail.de", "sogetthis.com",
        "soodonims.com", "spam.la",
        "spam.mn", "spam.org.tr",
        "spam.su", "spam4.me",
        "spamavert.com", "spambob.com",
        "spambob.net", "spambob.org",
        "spambog.com", "spambog.de",
        "spambog.ru", "spambox.info",
        "spambox.irishspringrealty.com", "spambox.us",
        "spamcannon.com", "spamcannon.net",
        "spamcero.com", "spamcon.org",
        "spamcorptastic.com", "spamcowboy.com",
        "spamcowboy.net", "spamcowboy.org",
        "spamday.com", "spamex.com",
        "spamfree.eu", "spamfree24.de",
        "spamfree24.eu", "spamfree24.info",
        "spamfree24.net", "spamfree24.org",
        "spamgoes.in", "spamgourmet.com",
        "spamgourmet.net", "spamgourmet.org",
        "spamherelots.com", "spamherelots.com.",
        "spamhereplease.com", "spamhole.com",
        "spamify.com", "spaminator.de",
        "spamkill.info", "spaml.com",
        "spaml.de", "spammotel.com",
        "spamobox.com", "spamoff.de",
        "spamslicer.com", "spamspot.com",
        "spamthis.co.uk", "spamthisplease.com",
        "spamtrail.com", "spamtroll.net",
        "speed.1s.fr", "spikio.com",
        "spoofmail.de", "stuffmail.de",
        "super-auswahl.de", "supergreatmail.com",
        "supermailer.jp", "superrito.com",
        "superstachel.de", "suremail.info",
        "svk.jp", "sweetxxx.de",
        "tafmail.com", "tagyourself.com",
        "techemail.com", "techgroup.me",
        "telecomix.pl", "tempalias.com",
        "tempe-mail.com", "tempemail.biz",
        "tempemail.com", "tempemail.net",
        "tempinbox.co.uk", "tempinbox.com",
        "tempmail.de", "tempmail.eu",
        "tempmail.it", "tempmail2.com",
        "tempomail.fr", "temporaryemail.net",
        "temporaryemail.us", "temporaryforwarding.com",
        "temporaryinbox.com", "temporarymail.org",
        "tempsky.com", "tempthe.net",
        "thanksnospam.info", "thisisnotmyrealemail.com",
        "thismail.net", "throwam.com",
        "throwaway.email", "tilien.com",
        "tittbit.in", "tizi.com",
        "tm.in.th", "tmailinator.com",
        "toiea.com", "tokenmail.de",
        "toomail.biz", "topranklist.de",
        "tradermail.info", "trash-mail.at",
        "trash-mail.com", "trash-mail.de",
        "trash-mail.ga", "trash-mail.io",
        "trash-mail.net", "trash2009.com",
        "trash2010.com", "trash2011.com",
        "trashdevil.com", "trashdevil.de",
        "trashemail.de", "trashimail.de",
        "trashmail.at", "trashmail.com",
        "trashmail.de", "trashmail.io",
        "trashmail.me", "trashmail.net",
        "trashmail.org", "trashmail.xyz",
        "trashmailer.com", "trashmalware.com",
        "trillianpro.com", "tryalert.com",
        "turual.com", "twinmail.de",
        "tyldd.com",
        "uggsrock.com", "umail.net",
        "upliftnow.com", "uplipht.com",
        "uroid.com", "us.af",
        "venompen.com", "veryrealemail.com",
        "viditag.com", "viralplays.com",
        "vkcode.ru", "vmani.com",
        "voidbay.com", "vomoto.com",
        "vpn.st", "vsimcard.com",
        "vubby.com",
        "wasteland.rfc822.org", "webemail.me",
        "webm4il.info", "wegwerfadresse.de",
        "wegwerfemail.com", "wegwerfemail.de",
        "wegwerfemail.net", "wegwerfemail.org",
        "wegwerfmail.de", "wegwerfmail.info",
        "wegwerfmail.net", "wegwerfmail.org",
        "wegwerfnummer.de", "wetrainbayarea.com",
        "wetrainbayarea.org", "wh4f.org",
        "whyspam.me", "wickmail.net",
        "wilemail.com", "willhackforfood.biz",
        "willselfdestruct.com", "winemaven.info",
        "wronghead.com", "wuzupmail.net",
        "www.e4ward.com", "www.gishpuppy.com",
        "www.mailinator.com",
        "xagloo.com", "xemaps.com",
        "xents.com", "xmaily.com",
        "xoxy.net", "xsmail.com",
        "xyzfree.net",
        "yapped.net", "yeah.net",
        "yep.it", "yogamaven.com",
        "yopmail.com", "yopmail.fr",
        "youmail.ga", "yourdomain.com",
        "ypmail.webarnak.fr.eu.org", "yuurok.com",
        "z1p.biz", "za.com",
        "zebins.com", "zebins.eu",
        "zehnminuten.de", "zippymail.info",
        "zoemail.com", "zoemail.net",
        "zoemail.org", "zomg.info",
        # Common typosquat / fake domains
        "gmaill.com", "gmali.com", "gnail.com",
        "hotmial.com", "hotmil.com", "hotnail.com",
        "yahooo.com", "yaho.com", "yahoomail.com",
        "outlookk.com", "outloook.com",
    }

    # Suspicious TLDs commonly used by disposable services
    SUSPICIOUS_TLDS = {
        "cf", "ga", "gq", "ml", "tk",   # free Freenom TLDs
        "xyz", "top", "click", "link",
        "pw", "win", "bid", "trade",
        "download", "racing", "review",
        "stream", "gdn", "accountant",
        "loan", "party", "science",
        "work", "ninja",
    }

    # Legitimate domains — never flag these
    WHITELIST_DOMAINS = {
        "gmail.com", "googlemail.com",
        "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de",
        "yahoo.es", "yahoo.it", "yahoo.com.au", "yahoo.co.jp",
        "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de",
        "hotmail.es", "hotmail.it",
        "outlook.com", "outlook.co.uk", "outlook.fr",
        "live.com", "live.co.uk", "live.fr",
        "msn.com", "passport.com",
        "icloud.com", "me.com", "mac.com",
        "protonmail.com", "protonmail.ch", "proton.me",
        "tutanota.com", "tutanota.de", "tutamail.com",
        "zoho.com", "zohomail.com",
        "aol.com", "aim.com",
        "mail.com", "email.com", "usa.com",
        "fastmail.com", "fastmail.fm",
        "hushmail.com", "hush.com",
        "gmx.com", "gmx.net", "gmx.de",
        "web.de", "freenet.de",
        "orange.fr", "free.fr", "sfr.fr",
        "wanadoo.fr", "laposte.net",
        "libero.it", "virgilio.it",
        "t-online.de", "vodafone.de",
        "comcast.net", "verizon.net",
        "att.net", "sbcglobal.net",
        "cox.net", "earthlink.net",
        "btinternet.com", "sky.com",
        "virginmedia.com", "ntlworld.com",
        "bell.net", "rogers.com", "shaw.ca",
        "telus.net", "sympatico.ca",
        "bigpond.com", "bigpond.net.au",
        "optusnet.com.au", "iinet.net.au",
    }

       
    # ------------------------------------------------------------------
    # Feature extraction
    # ------------------------------------------------------------------
    
    def _extract_features(self, email: str) -> dict:
        """Extract heuristic features from an email address."""
        email   = email.strip().lower()
        parts   = email.split("@")

        if len(parts) != 2:
            return {"valid": False}

        local, domain = parts[0], parts[1]
        domain_parts  = domain.split(".")
        tld           = domain_parts[-1] if domain_parts else ""
        sld           = domain_parts[-2] if len(domain_parts) >= 2 else ""

        # Local part analysis
        digit_ratio      = sum(c.isdigit() for c in local) / max(len(local), 1)
        has_random_str   = bool(re.search(r'[a-z]{8,}', local) and digit_ratio > 0.3)
        consecutive_nums = bool(re.search(r'\d{4,}', local))
        has_uuid_pattern = bool(re.search(r'[a-f0-9]{8,}', local))
        local_length     = len(local)
        dot_count        = local.count(".")
        plus_count       = local.count("+")  # alias indicators

        # Domain analysis
        domain_length    = len(domain)
        subdomain_count  = len(domain_parts) - 2
        has_numbers_in_domain = bool(re.search(r'\d', sld))
        domain_has_dash  = "-" in sld
        short_domain     = len(sld) <= 3
        very_long_domain = len(sld) >= 20

        return {
            "valid":               True,
            "local":               local,
            "domain":              domain,
            "tld":                 tld,
            "sld":                 sld,
            "digit_ratio":         digit_ratio,
            "has_random_str":      has_random_str,
            "consecutive_nums":    consecutive_nums,
            "has_uuid_pattern":    has_uuid_pattern,
            "local_length":        local_length,
            "dot_count":           dot_count,
            "plus_count":          plus_count,
            "domain_length":       domain_length,
            "subdomain_count":     subdomain_count,
            "has_numbers_in_domain": has_numbers_in_domain,
            "domain_has_dash":     domain_has_dash,
            "short_domain":        short_domain,
            "very_long_domain":    very_long_domain,
        }

    def _features_to_vector(self, f: dict) -> np.ndarray:
        """Convert feature dict to numeric vector for ML classifier."""
        if not f.get("valid"):
            return np.zeros(10, dtype=np.float32)
        return np.array([
            f["digit_ratio"],
            float(f["has_random_str"]),
            float(f["consecutive_nums"]),
            float(f["has_uuid_pattern"]),
            min(f["local_length"] / 30.0, 1.0),
            min(f["dot_count"] / 5.0, 1.0),
            float(f["plus_count"] > 0),
            min(f["domain_length"] / 40.0, 1.0),
            float(f["has_numbers_in_domain"]),
            float(f["domain_has_dash"]),
        ], dtype=np.float32)

    # ------------------------------------------------------------------
    # Core detection logic
    # ------------------------------------------------------------------

    def _check_email(self, email: str, ml_model=None, threshold=0.50) -> dict:
        """
        Run all detection layers and return full result.
        """
        email   = email.strip().lower()
        reasons = []
        checks  = {}

        # ── Validate format ────────────────────────────────────────────
        if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
            return {
                "is_disposable": True,
                "risk_score":    1.0,
                "confidence":    "certain",
                "reasons":       ["invalid email format"],
                "domain":        "",
                "checks":        {"format": False},
            }

        f      = self._extract_features(email)
        domain = f["domain"]
        tld    = f["tld"]

        # ── Layer 0: Whitelist ─────────────────────────────────────────
        if domain in self.WHITELIST_DOMAINS:
            return {
                "is_disposable": False,
                "risk_score":    0.02,
                "confidence":    "certain",
                "reasons":       [],
                "domain":        domain,
                "checks":        {"whitelist": True},
            }

        checks["whitelist"] = False

        # ── Layer 1: Blocklist ─────────────────────────────────────────
        blocklist_hit = domain in self.DISPOSABLE_DOMAINS
        checks["blocklist"] = blocklist_hit
        if blocklist_hit:
            reasons.append(f"domain '{domain}' is a known disposable provider")

        # ── Layer 2: Suspicious TLD ────────────────────────────────────
        suspicious_tld = tld in self.SUSPICIOUS_TLDS
        checks["suspicious_tld"] = suspicious_tld
        if suspicious_tld:
            reasons.append(f"suspicious TLD '.{tld}' commonly used by disposable services")

        # ── Layer 3: Pattern heuristics ────────────────────────────────
        heuristic_score = 0.0

        if f["digit_ratio"] > 0.5:
            heuristic_score += 0.25
            reasons.append("local part contains excessive numbers")

        if f["consecutive_nums"]:
            heuristic_score += 0.20
            reasons.append("local part contains long number sequence")

        if f["has_uuid_pattern"]:
            heuristic_score += 0.25
            reasons.append("local part matches random hash/UUID pattern")

        if f["local_length"] < 3:
            heuristic_score += 0.15
            reasons.append("local part is unusually short")

        if f["local_length"] > 25:
            heuristic_score += 0.15
            reasons.append("local part is unusually long")

        if f["very_long_domain"]:
            heuristic_score += 0.10
            reasons.append("domain name is unusually long")

        if f["plus_count"] > 0:
            heuristic_score += 0.10
            reasons.append("email contains plus alias (may be throwaway)")

        # Keyword patterns in domain
        disposable_keywords = [
            "temp", "trash", "spam", "junk", "fake", "throw",
            "dispos", "mailinator", "guerrilla", "yopmail",
            "10min", "minute", "burner", "noreply", "no-reply",
            "maildrop", "mailnull", "tempinbox",
        ]
        for kw in disposable_keywords:
            if kw in domain:
                heuristic_score += 0.30
                reasons.append(f"domain contains disposable keyword '{kw}'")
                break

        checks["heuristic_score"] = round(heuristic_score, 4)

        # ── Layer 4: ML classifier (if trained) ───────────────────────
        ml_score = None
        if ml_model is not None:
            vec      = self._features_to_vector(f).reshape(1, -1)
            ml_prob  = float(ml_model.predict_proba(vec)[0][1])
            ml_score = ml_prob
            checks["ml_score"] = round(ml_score, 4)

        # ── Aggregate risk score ───────────────────────────────────────
        # if blocklist_hit:
        #     risk_score = 0.97
        # else:
        #     base = heuristic_score
        #     if suspicious_tld:
        #         base += 0.30
        #     if ml_score is not None:
        #         # Blend heuristics (60%) + ML (40%)
        #         base = (base * 0.6) + (ml_score * 0.4)
        #     risk_score = round(min(base, 0.99), 4)
        if blocklist_hit:
            risk_score = 0.97
        else:
            base = heuristic_score
            if suspicious_tld:
                base += 0.30

            if ml_score is not None:
                if ml_score >= 0.85:
                    # ML is highly confident — let it lead, heuristics as a floor
                    reasons.append(f"ML classifier flagged domain with {ml_score:.0%} confidence")
                    blended = (ml_score * 0.75) + (base * 0.25)
                elif ml_score >= 0.50:
                    # Moderate ML signal — equal weight
                    blended = (ml_score * 0.50) + (base * 0.50)
                else:
                    # ML unsure — trust heuristics more
                    blended = (ml_score * 0.30) + (base * 0.70)
                base = blended

            risk_score = round(min(base, 0.99), 4)

        # ── Confidence ────────────────────────────────────────────────
        if blocklist_hit:
            confidence = "certain"
        elif risk_score >= 0.75:
            confidence = "high"
        elif risk_score >= 0.50:
            confidence = "medium"
        else:
            confidence = "low"

        is_disposable = risk_score >= threshold

        return {
            "is_disposable": is_disposable,
            "risk_score":    risk_score,
            "confidence":    confidence,
            "reasons":       reasons,
            "domain":        domain,
            "checks":        checks,
        }

    # ------------------------------------------------------------------
    # Preprocess
    # ------------------------------------------------------------------
    
    def preprocess(self, raw):
        
        from app.services.url_dataset_service import load_from_s3_sync
        items = []
        email_map = {}
        entered=[]


        for email in self.WHITELIST_DOMAINS:
            items.append({"id": f"gd_{len(items)}","email": f"user@{email}", "label": "legitimate"})
        
        
        
        for entry in raw:
            field_type = entry.get('field_type', '')
            label=entry.get('field_label','')
            entry_id=entry.get("entry_id","")
            if not entry.get('file_key'):
                logger.info("empty key")
                continue
            if (field_type not in ('image', 'file') and label not in ("Source Data")) or entry_id in entered:
                continue
            entered.append(entry_id)
            url_data = load_from_s3_sync(entry.get('file_key'))
            

            for domain in url_data:
                domain = domain.strip()
                if not domain:
                    continue
                # logger.info(f"Scanning plugins...{domain}")
                self.DISPOSABLE_DOMAINS.add(domain)
                items.append({
                    "id": f"url_{len(items)}",
                    "email": f"user@{domain}",
                    "label": "disposable",
                })
       

        return items

    # ------------------------------------------------------------------
    # Train
    # ------------------------------------------------------------------

    def train(self, preprocessed, config: TrainingConfig):
        from sklearn.ensemble import GradientBoostingClassifier

        ml_model  = None
        threshold = 0.50

        if preprocessed and len(preprocessed) >= 10:
            X = np.stack([
                self._features_to_vector(self._extract_features(item["email"]))
                for item in preprocessed
            ])
            y = np.array([
                1 if item["label"] == "disposable" else 0
                for item in preprocessed
            ])

            ml_model = GradientBoostingClassifier(
                n_estimators=100,
                max_depth=4,
                learning_rate=0.1,
                random_state=42,
            )
            ml_model.fit(X, y)

            # Calibrate threshold
            probs      = ml_model.predict_proba(X)[:, 1]
            best_acc   = 0.0
            best_t     = 0.50
            for t in np.arange(0.30, 0.80, 0.01):
                preds = (probs >= t).astype(int)
                acc   = (preds == y).mean()
                if acc > best_acc:
                    best_acc = acc
                    best_t   = float(t)
            threshold = round(best_t, 2)

        bundle = TrainerBundle(
            model=ml_model,   # None if no training data
            extra={
                "threshold":   threshold,
                "has_ml":      ml_model is not None,
                "n_samples":   len(preprocessed),
            },
        )
        return bundle, preprocessed

    # ------------------------------------------------------------------
    # Predict
    # ------------------------------------------------------------------

    def predict(self, model: TrainerBundle, inputs: dict) -> dict:
        email     = inputs.get("email", "").strip()
        ml_model  = model.model   # may be None
        threshold = model.extra.get("threshold", 0.50)

        return self._check_email(email, ml_model=ml_model, threshold=threshold)

    # ------------------------------------------------------------------
    # Evaluate
    # ------------------------------------------------------------------

    def evaluate(self, model: TrainerBundle, test_data) -> EvaluationResult:
        if not test_data:
            return EvaluationResult(
                extra_metrics={
                    "threshold":  model.extra.get("threshold", 0.50),
                    "has_ml":     int(model.extra.get("has_ml", False)),
                    "n_samples":  model.extra.get("n_samples", 0),
                }
            )

        threshold = model.extra.get("threshold", 0.50)
        ml_model  = model.model

        y_true, y_pred = [], []

        for item in test_data:
            result = self._check_email(item["email"], ml_model=ml_model, threshold=threshold)
            y_pred.append(1 if result["is_disposable"] else 0)
            y_true.append(1 if item["label"] == "disposable" else 0)

        y_true = np.array(y_true)
        y_pred = np.array(y_pred)

        tp = int(((y_pred == 1) & (y_true == 1)).sum())
        tn = int(((y_pred == 0) & (y_true == 0)).sum())
        fp = int(((y_pred == 1) & (y_true == 0)).sum())
        fn = int(((y_pred == 0) & (y_true == 1)).sum())

        accuracy  = round((tp + tn) / max(len(y_true), 1), 4)
        precision = round(tp / max(tp + fp, 1), 4)
        recall    = round(tp / max(tp + fn, 1), 4)
        f1        = round(2 * precision * recall / max(precision + recall, 1e-8), 4)

        return EvaluationResult(
            extra_metrics={
                "accuracy":   accuracy,
                "precision":  precision,
                "recall":     recall,
                "f1":   f1,
            },
            tags={
                "tp": tp, "tn": tn, "fp": fp, "fn": fn,
                "threshold":  threshold,
                "has_ml":     int(model.extra.get("has_ml", False)),
            }
        )